// 기록에 적힌 메뉴로 가게 찾기.
// 카카오는 가게 이름과 분류로만 찾아서 "제육"으로는 제육이 대표 메뉴가 아닌 가게가 안 나온다.
// 한 줄 추천의 문장(먹은 메뉴 칸이 생기면 그 칸도)에 검색어가 들어 있는 가게를 찾아 카카오 결과 앞에 붙인다.

// 기록으로 찾은 가게는 이 개수까지만 붙인다
const MAX_RECORD_PLACES = 10;

// 띄어쓰기를 모두 지우고 영어는 소문자로. "제 육"과 "제육"을 같게 본다
function compact(text) {
  if (typeof text !== 'string') {
    return '';
  }
  return text.replace(/\s+/g, '').toLowerCase();
}

// 한 줄 추천 하나에 검색어가 들어 있는지. 문장, 먹은 메뉴(menu), LLM이 글에서 뽑은 메뉴(menus)를 본다.
// 글에는 "제육"이라고만 썼어도 LLM이 "제육볶음"으로 뽑아 뒀으면 "제육볶음"으로도 찾힌다.
// 신고로 숨긴 글(R15)은 찾지 않는다
function reviewMatches(review, query) {
  const target = compact(query);
  if (target === '' || !review || review.hidden) {
    return false;
  }
  if (compact(review.text).includes(target) || compact(review.menu).includes(target)) {
    return true;
  }
  return Array.isArray(review.menus) && review.menus.some((menu) => compact(menu).includes(target));
}

// 검색어가 들어 있는 기록이 있는 가게를 찾는다.
// 맞는 기록이 많은 가게가 앞이고, 같으면 가장 최근 기록이 새로운 가게가 앞이다.
// 돌려주는 가게에는 fromRecords: true 를 붙인다. 주소는 저장하지 않아서 빈 문자열이다
function findPlacesByRecords(places, reviews, query) {
  if (!Array.isArray(places) || !Array.isArray(reviews) || compact(query) === '') {
    return [];
  }

  // 가게 id -> { count, latest }
  const matched = new Map();
  for (const review of reviews) {
    if (!reviewMatches(review, query)) {
      continue;
    }
    const entry = matched.get(review.placeId) || { count: 0, latest: '' };
    entry.count += 1;
    if (typeof review.createdAt === 'string' && review.createdAt > entry.latest) {
      entry.latest = review.createdAt;
    }
    matched.set(review.placeId, entry);
  }

  const results = [];
  for (const place of places) {
    const entry = matched.get(place.id);
    if (!entry) {
      continue;
    }
    results.push({
      place: {
        id: place.id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        category: place.category,
        address: '',
        fromRecords: true,
      },
      count: entry.count,
      latest: entry.latest,
    });
  }

  results.sort((a, b) => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    if (a.latest === b.latest) {
      return 0;
    }
    return a.latest < b.latest ? 1 : -1;
  });

  return results.slice(0, MAX_RECORD_PLACES).map((result) => result.place);
}

// 기록으로 찾은 가게를 카카오 결과 앞에 붙인다.
// 같은 가게가 양쪽에 있으면 한 번만 넣고, 주소는 카카오 쪽 것을 쓴다
function mergeResults(recordPlaces, kakaoPlaces) {
  const kakaoById = new Map();
  for (const place of kakaoPlaces || []) {
    kakaoById.set(place.id, place);
  }

  const merged = [];
  const used = new Set();
  for (const place of recordPlaces || []) {
    const fromKakao = kakaoById.get(place.id);
    merged.push(fromKakao ? { ...fromKakao, fromRecords: true } : place);
    used.add(place.id);
  }
  for (const place of kakaoPlaces || []) {
    if (!used.has(place.id)) {
      merged.push(place);
    }
  }
  return merged;
}

module.exports = {
  MAX_RECORD_PLACES,
  compact,
  reviewMatches,
  findPlacesByRecords,
  mergeResults,
};
