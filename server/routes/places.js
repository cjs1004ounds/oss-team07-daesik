const express = require('express');

const kakao = require('../kakao');
const store = require('../store');
const searchCache = require('../../shared/searchCache');
const { findPlacesByRecords, mergeResults } = require('../../shared/recordSearch');
const { againStats, averagePrice, lastRecordAt } = require('../../shared/recordWeight');
const { walkMinutes, isWithinWalk, placeTags, parseFilter, matchesFilter } = require('../../shared/placeFilter');

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

// 가게 하나의 비율, 가격, 마지막 기록 (R14). 최근 기록일수록 크게 반영한다
function placeStats(placeId, now) {
  const reviews = visibleReviews(placeId);
  const visits = store.getVisitsByPlace(placeId);
  const again = againStats(visits, now);
  return {
    responseCount: again.responseCount,
    againRatio: again.againRatio,
    averagePrice: averagePrice(reviews, now),
    lastRecordAt: lastRecordAt([...reviews, ...visits]),
  };
}

// GET /api/places?maxPrice=8000&category=한식&tags=혼밥,가성비
// 기록이 있는 가게 목록. 가게마다 한 줄 추천 수(reviewCount)를 붙인다. 숨긴 글은 세지 않는다.
// 또 갈래요 비율, 1인 가격 평균, 마지막 기록 날짜(R14)와 도보 시간(R1), 가게 태그(R3)도 붙인다.
// 학교에서 걸어서 15분이 넘는 가게는 뺀다(R2). 쿼리를 보내면 가격 상한, 음식 종류, 태그로 거른다(R3).
// 정렬(R5)은 아직 없다
router.get('/', (req, res) => {
  const filter = parseFilter(req.query);
  if (!filter.ok) {
    res.status(400).json({ error: filter.error });
    return;
  }

  const now = new Date();
  const places = store
    .getPlaces()
    .map((place) => {
      const reviews = visibleReviews(place.id);
      return {
        ...toPlaceResponse(place),
        reviewCount: reviews.length,
        ...placeStats(place.id, now),
        walkMinutes: walkMinutes(place),
        tags: placeTags(reviews),
      };
    })
    .filter((place) => isWithinWalk(place.walkMinutes))
    .filter((place) => matchesFilter(place, filter.value));

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

  res.json({ place: toPlaceResponse(place), stats: placeStats(place.id, new Date()), reviews });
});

module.exports = router;