const express = require('express');

const kakao = require('../kakao');
const searchCache = require('../../shared/searchCache');

const router = express.Router();

// 검색 결과를 잠깐 저장해 두는 곳 (R9). 서버를 끄면 사라져도 되는 값이라 파일에 쓰지 않는다
const cache = new Map();

// GET /api/places/search?q=검색어
// 카카오 로컬 API로 가게를 검색한다. 같은 검색어는 10분 동안 저장해 둔 결과를 돌려준다
router.get('/search', async (req, res) => {
  const query = searchCache.normalizeQuery(req.query.q);
  if (query === '') {
    res.status(400).json({ error: '검색어를 입력해 주세요.' });
    return;
  }

  const cached = searchCache.getCached(cache, query, Date.now());
  if (cached) {
    res.json({ places: cached });
    return;
  }

  try {
    const places = await kakao.searchPlaces(query);
    searchCache.setCached(cache, query, places, Date.now());
    res.json({ places: places });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: '가게 검색을 지금 쓸 수 없습니다. 잠시 뒤에 다시 해 주세요.' });
  }
});

// GET /api/places 와 GET /api/places/:id 가 들어올 자리.
// /:id 는 /search 보다 아래에 둬야 /search 가 가게 id로 읽히지 않는다

module.exports = router;
