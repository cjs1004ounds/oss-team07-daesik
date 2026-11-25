const express = require('express');

const kakao = require('../kakao');
const llm = require('../llm');
const store = require('../store');
const searchCache = require('../../shared/searchCache');
const { findPlacesByRecords, mergeResults } = require('../../shared/recordSearch');
const { againStats, averagePrice, lastRecordAt } = require('../../shared/recordWeight');
const { shouldExpand, buildExpandPrompt, parseExpansion } = require('../../shared/searchExpand');
const { needsSummary, summaryKey, buildSummaryPrompt, parseSummary } = require('../../shared/placeSummary');
const { COMMON_CATEGORIES, MAX_QUESTION_LENGTH, buildAskPrompt, parseAsk, isEmptyFilter } = require('../../shared/askFilter');
const { ALLOWED_TAGS } = require('../../shared/reviewValidator');
const { isKind, hasRecentReport, summarizeLive } = require('../../shared/liveStatus');
const { take, cleanUp } = require('../../shared/usageLimit');
const priceRanges = require('../priceRanges');
const { findHeldPrices, needsCategoryRange, categoryKey } = require('../../shared/priceCheck');
const { walkMinutes, isWithinWalk, placeTags, parseFilter, matchesFilter, shortCategory } = require('../../shared/placeFilter');
const { sortPlaces } = require('../../shared/placeSort');

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

// 검색어 최대 길이. 긴 문장으로 LLM 토큰을 많이 쓰게 만드는 것을 막는다
const MAX_QUERY_LENGTH = 50;

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
async function getExpandedKeywords(query, clientKey) {
  const saved = expandCache.get(query);
  if (saved && Date.now() - saved.savedAt < EXPAND_CACHE_MS) {
    return saved.keywords;
  }

  let keywords = [];
  try {
    const raw = await llm.generateJson(buildExpandPrompt(query), { timeoutMs: EXPAND_TIMEOUT_MS, clientKey: clientKey });
    const result = parseExpansion(raw, query);
    if (result.ok) {
      keywords = result.value;
    } else {
      console.error('검색어 넓히기 응답을 쓸 수 없습니다: ' + result.error);
    }
  } catch (err) {
    console.error('검색어 넓히기 실패: ' + err.message);
    // 사람별 한도에 걸린 것은 그 사람 사정이라 저장하지 않는다. 다른 사람이 같은 검색어로 찾으면 넓힐 수 있게
    if (err.code === 'LLM_LIMIT') {
      return [];
    }
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
  if (query.length > MAX_QUERY_LENGTH) {
    res.status(400).json({ error: '검색어는 ' + MAX_QUERY_LENGTH + '자까지 입력할 수 있습니다.' });
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
    const keywords = await getExpandedKeywords(query, req.ip);
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
// priceHeld는 이상한 가격으로 보류됐는지(R17). 보류된 가격은 보이기는 하고 평균에는 넣지 않는다
function toReviewResponse(review, held) {
  return {
    id: review.id,
    text: review.text,
    price: review.price,
    priceHeld: held ? held.has(review.id) : false,
    tags: review.tags,
    createdAt: review.createdAt,
  };
}

// 가게의 추천에서 보류할 가격을 찾는다 (R17). 보통 가격 범위는 저장해 둔 것만 쓰고 여기서 LLM을 부르지 않는다
function heldPricesOf(place, reviews) {
  return findHeldPrices(reviews, priceRanges.getCachedRange(categoryKey(place.category)));
}

// 보여 줄 한 줄 추천. 신고로 숨긴 글(R15)은 뺀다
function visibleReviews(placeId) {
  return store.getReviewsByPlace(placeId).filter((review) => !review.hidden);
}

// 가게 하나의 비율, 가격, 마지막 기록 (R14). 최근 기록일수록 크게 반영한다
function placeStats(place, now) {
  const placeId = place.id;
  const reviews = visibleReviews(placeId);
  const visits = store.getVisitsByPlace(placeId);
  const again = againStats(visits, now);
  // 보류한 가격(R17)은 평균에 넣지 않는다
  const held = heldPricesOf(place, reviews);
  const pricedReviews = reviews.filter((review) => !held.has(review.id));
  return {
    responseCount: again.responseCount,
    againRatio: again.againRatio,
    averagePrice: averagePrice(pricedReviews, now),
    lastRecordAt: lastRecordAt([...reviews, ...visits]),
  };
}

// GET /api/places?maxPrice=8000&category=한식&tags=혼밥,가성비
// 기록이 있는 가게 목록. 가게마다 한 줄 추천 수(reviewCount)를 붙인다. 숨긴 글은 세지 않는다.
// 또 갈래요 비율, 1인 가격 평균, 마지막 기록 날짜(R14)와 도보 시간(R1), 가게 태그(R3)도 붙인다.
// 학교에서 걸어서 15분이 넘는 가게는 뺀다(R2). 쿼리를 보내면 가격 상한, 음식 종류, 태그로 거른다(R3).
// 남은 가게는 또 갈래요 비율이 높은 순, 같으면 가까운 순으로 정렬하고 "기록 부족"은 맨 뒤에 둔다(R5)
router.get('/', (req, res) => {
  const filter = parseFilter(req.query);
  if (!filter.ok) {
    res.status(400).json({ error: filter.error });
    return;
  }

  res.json({ places: listPlaces(filter.value) });
});

// 기록이 있는 가게 목록을 만들어 거르고 R5 순서로 정렬한다. GET /api/places와 말로 찾기가 같이 쓴다.
// maxWalk(걸어서 몇 분 안)는 말로 찾기에서만 온다. 없으면 R2의 15분만 본다
function listPlaces(filter) {
  const now = new Date();
  // R3 필터(matchesFilter)는 음식 종류가 없으면 빈 문자열을 받는다. 말로 찾기는 null을 줘서 맞춘다
  const r3Filter = { maxPrice: filter.maxPrice, category: filter.category || '', tags: filter.tags };
  const places = store
    .getPlaces()
    .map((place) => {
      const reviews = visibleReviews(place.id);
      return {
        ...toPlaceResponse(place),
        reviewCount: reviews.length,
        ...placeStats(place, now),
        walkMinutes: walkMinutes(place),
        tags: placeTags(reviews),
        live: summarizeLive(store.getStatusesByPlace(place.id), now),
      };
    })
    .filter((place) => isWithinWalk(place.walkMinutes))
    .filter((place) => !filter.maxWalk || place.walkMinutes <= filter.maxWalk)
    .filter((place) => matchesFilter(place, r3Filter));
  return sortPlaces(places);
}

// 말로 찾기에서 고를 수 있는 음식 종류. 자주 나오는 것에 지금 기록된 가게의 종류를 더한다
function askCategories() {
  const categories = [...COMMON_CATEGORIES];
  for (const place of store.getPlaces()) {
    const category = shortCategory(place.category);
    if (category !== '' && !categories.includes(category)) {
      categories.push(category);
    }
  }
  return categories;
}

// 말로 찾기 결과를 문장별로 저장해 두는 곳. 같은 문장으로 LLM을 다시 부르지 않으려는 것이다
const askCache = new Map();
const ASK_CACHE_MS = 24 * 60 * 60 * 1000;
const ASK_TIMEOUT_MS = 5000;

// POST /api/places/ask
// "8천원 이하로 혼밥하기 좋은 데"를 LLM이 필터로 바꾸고, 그 필터로 GET /api/places처럼 거른다.
// LLM은 필터 값만 만들고 가게를 고르거나 순서를 바꾸지 않는다
router.post('/ask', async (req, res) => {
  const { question } = req.body || {};
  const text = typeof question === 'string' ? question.trim().replace(/\s+/g, ' ') : '';
  if (text === '' || text.length > MAX_QUESTION_LENGTH) {
    res.status(400).json({ error: '찾고 싶은 것을 ' + MAX_QUESTION_LENGTH + '자 안으로 적어 주세요.' });
    return;
  }

  const cacheKey = text.toLowerCase();
  const saved = askCache.get(cacheKey);
  let filter = saved && Date.now() - saved.savedAt < ASK_CACHE_MS ? saved.filter : null;

  if (!filter) {
    try {
      const categories = askCategories();
      const raw = await llm.generateJson(buildAskPrompt(text, categories, ALLOWED_TAGS), {
        timeoutMs: ASK_TIMEOUT_MS,
        clientKey: req.ip,
      });
      const result = parseAsk(raw, categories, ALLOWED_TAGS);
      if (!result.ok) {
        console.error('말로 찾기 응답을 쓸 수 없습니다: ' + result.error);
        res.status(503).json({ error: '말을 필터로 바꾸지 못했습니다. 필터를 직접 골라 주세요.' });
        return;
      }
      filter = result.value;
      askCache.set(cacheKey, { filter: filter, savedAt: Date.now() });
    } catch (err) {
      console.error('말로 찾기 실패: ' + err.message);
      if (err.code === 'LLM_LIMIT') {
        res.status(429).json({ error: '잠시 뒤에 다시 해 주세요. 필터는 직접 고를 수 있습니다.' });
        return;
      }
      res.status(503).json({ error: '지금은 말로 찾기를 쓸 수 없습니다. 필터를 직접 골라 주세요.' });
      return;
    }
  }

  if (isEmptyFilter(filter)) {
    res.json({ filter: filter, places: [], message: '어떤 가게를 찾는지 알아듣지 못했습니다. 가격, 음식 종류, 혼밥 같은 말을 넣어 보세요.' });
    return;
  }
  res.json({ filter: filter, places: listPlaces(filter) });
});

// 요약은 화면이 기다리는 동안 만들기 때문에 오래 기다리지 않는다
const SUMMARY_TIMEOUT_MS = 4000;

// 같은 가게의 요약을 동시에 두 번 만들지 않게, 만드는 중인 것을 들고 있는다
const summariesInProgress = new Map();

// 가게 한 줄 요약. 추천이 그대로면 저장해 둔 요약을 쓰고, 달라졌으면 LLM으로 다시 만든다.
// 추천이 2개보다 적거나 LLM이 실패하면 null
async function getPlaceSummary(place, reviews, clientKey) {
  if (!needsSummary(reviews)) {
    return null;
  }
  const key = summaryKey(reviews);
  if (place.summary && place.summary.key === key) {
    return place.summary.text;
  }

  if (!summariesInProgress.has(place.id)) {
    const job = (async () => {
      try {
        const raw = await llm.generateJson(buildSummaryPrompt(place.name, reviews), {
          timeoutMs: SUMMARY_TIMEOUT_MS,
          clientKey: clientKey,
        });
        const result = parseSummary(raw);
        if (!result.ok) {
          console.error('가게 요약을 쓸 수 없습니다: ' + result.error);
          return null;
        }
        store.setPlaceSummary(place.id, { text: result.value, key: key });
        return result.value;
      } catch (err) {
        console.error('가게 요약 실패: ' + err.message);
        return null;
      } finally {
        summariesInProgress.delete(place.id);
      }
    })();
    summariesInProgress.set(place.id, job);
  }
  return summariesInProgress.get(place.id);
}

// GET /api/places/:id
// 가게 하나와 그 가게의 한 줄 추천. 추천은 최근에 남긴 것이 앞에 오고, 숨긴 글은 뺀다.
// /search 보다 아래에 둬야 /search 가 가게 id로 읽히지 않는다
router.get('/:id', async (req, res) => {
  const place = store.getPlace(req.params.id);
  if (!place) {
    res.status(404).json({ error: '없는 가게입니다.' });
    return;
  }

  const visible = visibleReviews(place.id);

  // 요약과 보통 가격 범위(R17)는 같이 기다린다. 범위는 그걸로 판단할 가격이 있을 때만 구한다
  const [summary] = await Promise.all([
    getPlaceSummary(place, visible, req.ip),
    needsCategoryRange(visible) ? priceRanges.ensureRange(categoryKey(place.category), req.ip) : null,
  ]);

  const held = heldPricesOf(place, visible);
  const reviews = visible
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((review) => toReviewResponse(review, held));

  res.json({
    place: toPlaceResponse(place),
    stats: placeStats(place, new Date()),
    live: summarizeLive(store.getStatusesByPlace(place.id), new Date()),
    summary: summary,
    reviews,
  });
});

// 지금 상황 제보를 같은 접속 IP가 1시간에 몇 번까지 할 수 있는지. 새 창으로 여러 번 제보하는 것을 막는다
const STATUS_PER_IP_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
const statusCounters = new Map();

// POST /api/places/:id/status
// 지금 상황 제보 (R16). "웨이팅 있어요"(waiting) 또는 "자리 있어요"(seats). 30분 동안만 보인다
router.post('/:id/status', (req, res) => {
  const place = store.getPlace(req.params.id);
  if (!place) {
    res.status(404).json({ error: '없는 가게입니다.' });
    return;
  }

  const { kind, anonId } = req.body || {};
  if (!isKind(kind)) {
    res.status(400).json({ error: '제보 종류가 올바르지 않습니다.' });
    return;
  }
  if (typeof anonId !== 'string' || anonId.trim() === '' || anonId.trim().length > 100) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }

  const now = Date.now();
  const id = anonId.trim();
  if (hasRecentReport(store.getStatusesByPlace(place.id), place.id, id, now)) {
    res.status(409).json({ error: '이 가게는 30분 안에 이미 제보했습니다.' });
    return;
  }

  cleanUp(statusCounters, HOUR_MS, now);
  if (!take(statusCounters, req.ip, STATUS_PER_IP_LIMIT, HOUR_MS, now).ok) {
    res.status(429).json({ error: '제보가 너무 많습니다. 잠시 뒤에 다시 해 주세요.' });
    return;
  }

  store.addStatus({ placeId: place.id, kind: kind, anonId: id });
  res.status(201).json({ live: summarizeLive(store.getStatusesByPlace(place.id), new Date()) });
});

module.exports = router;