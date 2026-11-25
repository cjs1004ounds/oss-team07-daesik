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

// 화면에 내보낼 가게 값. 저장된 가게에 다른 값이 더 붙어 있어도 이것만 내보낸다
function toPlaceResponse(place) {
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
  };
}

// 화면에 내보낼 한 줄 추천 값. 익명 ID(anonId)는 내보내지 않는다
function toReviewResponse(review) {
  return {
    id: review.id,
    text: review.text,
    price: review.price,
    tags: review.tags,
    createdAt: review.createdAt,
  };
}

// 보여 줄 한 줄 추천. 신고로 숨긴 글(R15)은 뺀다
function visibleReviews(placeId) {
  return store.getReviewsByPlace(placeId).filter((review) => !review.hidden);
}

// GET /api/places
// 기록이 있는 가게 목록. 가게마다 한 줄 추천 수(reviewCount)를 붙인다. 숨긴 글은 세지 않는다.
// 필터와 정렬(R1~R5)은 아직 없고 저장된 가게를 전부 돌려준다
router.get('/', (req, res) => {
  const places = store.getPlaces().map((place) => ({
    ...toPlaceResponse(place),
    reviewCount: visibleReviews(place.id).length,
  }));

  res.json({ places });
});

// GET /api/places/:id
// 가게 하나와 그 가게의 한 줄 추천. 추천은 최근에 남긴 것이 앞에 오고, 숨긴 글은 뺀다.
// /search 보다 아래에 둬야 /search 가 가게 id로 읽히지 않는다
router.get('/:id', (req, res) => {
  const place = store.getPlace(req.params.id);
  if (!place) {
    res.status(404).json({ error: '없는 가게입니다.' });
    return;
  }

  const reviews = visibleReviews(place.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toReviewResponse);

  res.json({ place: toPlaceResponse(place), reviews });
});

module.exports = router;
