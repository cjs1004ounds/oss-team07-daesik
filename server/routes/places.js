const express = require('express');

const kakao = require('../kakao');
const store = require('../store');
const searchCache = require('../../shared/searchCache');
const { findPlacesByRecords, mergeResults } = require('../../shared/recordSearch');

const router = express.Router();

// 검색 결과를 잠깐 저장해 두는 곳 (R9). 서버를 끄면 사라져도 되는 값이라 파일에 쓰지 않는다
const cache = new Map();

// GET /api/places/search?q=검색어
// 카카오 로컬 API로 가게를 검색한다. 같은 검색어는 10분 동안 저장해 둔 결과를 돌려준다.
// 우리 기록에 검색어가 적힌 가게는 카카오 결과 앞에 붙인다 (예: "제육"이 적힌 한 줄 추천이 있는 가게)
router.get('/search', async (req, res) => {
  const query = searchCache.normalizeQuery(req.query.q);
  if (query === '') {
    res.status(400).json({ error: '검색어를 입력해 주세요.' });
    return;
  }

  // 기록에서 찾는 것은 저장해 두지 않고 매번 한다. 방금 남긴 기록도 바로 찾히게 하려는 것이다
  const recordPlaces = findPlacesByRecords(store.getPlaces(), store.getReviews(), query);

  const cached = searchCache.getCached(cache, query, Date.now());
  if (cached) {
    res.json({ places: mergeResults(recordPlaces, cached) });
    return;
  }

  try {
    const places = await kakao.searchPlaces(query);
    searchCache.setCached(cache, query, places, Date.now());
    res.json({ places: mergeResults(recordPlaces, places) });
  } catch (err) {
    console.error(err.message);
    // 카카오를 못 써도 기록으로 찾은 가게가 있으면 그것만이라도 보여 준다
    if (recordPlaces.length > 0) {
      res.json({ places: recordPlaces });
      return;
    }
    res.status(502).json({ error: '가게 검색을 지금 쓸 수 없습니다. 잠시 뒤에 다시 해 주세요.' });
  }
});

// GET /api/places 와 GET /api/places/:id 가 들어올 자리.
// /:id 는 /search 보다 아래에 둬야 /search 가 가게 id로 읽히지 않는다

module.exports = router;
