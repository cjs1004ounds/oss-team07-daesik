const express = require('express');

const kakao = require('../kakao');
const llm = require('../llm');
const store = require('../store');
const searchCache = require('../../shared/searchCache');
const { findPlacesByRecords, mergeResults } = require('../../shared/recordSearch');
const { againStats, averagePrice, lastRecordAt } = require('../../shared/recordWeight');
const { shouldExpand, buildExpandPrompt, parseExpansion } = require('../../shared/searchExpand');
const { walkMinutes, isWithinWalk, placeTags, parseFilter, matchesFilter } = require('../../shared/placeFilter');

const router = express.Router();

// 검색 결과를 잠깐 저장해 두는 곳 (R9). 서버를 끄면 사라져도 되는 값이라 파일에 쓰지 않는다
const cache = new Map();

// LLM이 넓혀 준 검색어를 검색어별로 저장해 두는 곳. 같은 검색어로 LLM을 다시 부르지 않으려는 것이다
const expandCache = new Map();
const EXPAND_CACHE_MS = 24 * 60 * 60 * 1000;

// 검색어 넓히기는 화면이 기다리는 동안 하는 일이라 오래 기다리지 않는다
const EXPAND_TIMEOUT_MS = 4000;

// 한 번에 돌려주는 가게 수
const MAX_SEARCH_RESULTS = 30;

// 카카오 검색. 같은 검색어는 10분 동안 저장해 둔 결과를 쓴다 (R9). 실패하면 오류를 던진다
async function searchKakao(query) {
  const cached = searchCache.getCached(cache, query, Date.now());
  if (cached) {
    return cached;
  }
  const places = await kakao.searchPlaces(query);
  searchCache.setCached(cache, query, places, Date.now());
  return places;
}

// LLM에게 넓힌 검색어를 받는다. 키가 없거나 실패하면 빈 목록이고, 그 결과도 하루 동안 저장한다
// (한도를 넘었을 때 검색할 때마다 다시 부르지 않게)
async function getExpandedKeywords(query) {
  const saved = expandCache.get(query);
  if (saved && Date.now() - saved.savedAt < EXPAND_CACHE_MS) {
    return saved.keywords;
  }

  let keywords = [];
  try {
    const raw = await llm.generateJson(buildExpandPrompt(query), { timeoutMs: EXPAND_TIMEOUT_MS });
    const result = parseExpansion(raw, query);
    if (result.ok) {
      keywords = result.value;
    } else {
      console.error('검색어 넓히기 응답을 쓸 수 없습니다: ' + result.error);
    }
  } catch (err) {
    console.error('검색어 넓히기 실패: ' + err.message);
  }

  expandCache.set(query, { keywords: keywords, savedAt: Date.now() });
  return keywords;
}

// 앞의 목록에 없는 가게만 뒤에 붙인다. via가 있으면 어떤 검색어로 찾았는지 붙인다
function appendNew(list, places, via) {
  const ids = new Set(list.map((place) => place.id));
  for (const place of places) {
    if (!ids.has(place.id)) {
      ids.add(place.id);
      list.push(via ? { ...place, via: via } : place);
    }
  }
  return list;
}

// GET /api/places/search?q=검색어
// 카카오 로컬 API로 음식점과 카페를 검색한다. 같은 검색어는 10분 동안 저장해 둔 결과를 쓴다 (R9).
// 우리 기록에 검색어가 적힌 가게는 카카오 결과 앞에 붙인다 (예: "제육"이 적힌 한 줄 추천이 있는 가게).
// 결과가 적으면 LLM이 넓혀 준 검색어(예: 제육 -> 제육볶음)로 한 번 더 찾아 뒤에 붙인다
router.get('/search', async (req, res) => {
  const query = searchCache.normalizeQuery(req.query.q);
  if (query === '') {
    res.status(400).json({ error: '검색어를 입력해 주세요.' });
    return;
  }

  // 기록에서 찾는 것은 저장해 두지 않고 매번 한다. 방금 남긴 기록도 바로 찾히게 하려는 것이다
  const places = store.getPlaces();
  const reviews = store.getReviews();
  const recordPlaces = findPlacesByRecords(places, reviews, query);

  let kakaoPlaces;
  try {
    kakaoPlaces = await searchKakao(query);
  } catch (err) {
    console.error(err.message);
    // 카카오를 못 써도 기록으로 찾은 가게가 있으면 그것만이라도 보여 준다. 이때는 검색어를 넓히지 않는다
    if (recordPlaces.length > 0) {
      res.json({ places: recordPlaces });
      return;
    }
    res.status(502).json({ error: '가게 검색을 지금 쓸 수 없습니다. 잠시 뒤에 다시 해 주세요.' });
    return;
  }

  const results = mergeResults(recordPlaces, kakaoPlaces);

  if (shouldExpand(results.length)) {
    const keywords = await getExpandedKeywords(query);
    // 넓힌 검색어들은 한꺼번에 찾는다. 하나가 실패해도 나머지는 쓴다
    const found = await Promise.all(
      keywords.map(async (keyword) => {
        const fromRecords = findPlacesByRecords(places, reviews, keyword);
        let fromKakao = [];
        try {
          fromKakao = await searchKakao(keyword);
        } catch (err) {
          console.error(err.message);
        }
        return { keyword: keyword, places: mergeResults(fromRecords, fromKakao) };
      })
    );
    for (const item of found) {
      appendNew(results, item.places, item.keyword);
    }
  }

  res.json({ places: results.slice(0, MAX_SEARCH_RESULTS) });
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