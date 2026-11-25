// R1 도보 시간, R2 15분 제외, R3 필터.
// 기록이 있는 가게 목록(GET /api/places)에서 쓴다.
//
//   R1 도보 시간(분) = 학교 기준점에서 가게까지 직선거리 / 67m, 올림
//   R2 도보 시간이 15분을 넘으면 목록에서 뺀다. 15분은 포함
//   R3 1인 가격 상한, 음식 종류, 태그로 거른다
//
// 쓰는 가게 값의 모양
//   { lat, lng, category, averagePrice, tags }
//   averagePrice는 shared/recordWeight.js의 averagePrice(R14 가중치를 준 평균)를 그대로 쓴다

// 학교 기준점. 팀에서 아직 정하지 않아서 지도 가운데(public/js/map.js의 SCHOOL)와 같은 값을 쓴다.
// 정해지면 이 값과 map.js를 같이 바꾼다 (README "아직 못 정한 것")
const SCHOOL = { lat: 37.61924, lng: 127.05827 };

// 1분에 걷는 거리(m). 성인 보통 걸음(시속 약 4km)
const WALK_METERS_PER_MINUTE = 67;

// 이 시간(분)을 넘는 가게는 목록에서 뺀다 (R2)
const MAX_WALK_MINUTES = 15;

// 지구 반지름(m). 직선거리 계산에 쓴다
const EARTH_RADIUS_M = 6371000;

// 두 좌표 사이의 직선거리(m). 하버사인 공식
function distanceMeters(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// 거리(m)를 도보 시간(분)으로. 올림이라 1m만 걸어도 1분이다 (R1)
function minutesForDistance(meters) {
  return Math.ceil(meters / WALK_METERS_PER_MINUTE);
}

// 가게의 도보 시간(분). 좌표가 숫자가 아니면 null
function walkMinutes(place, origin = SCHOOL) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
    return null;
  }
  return minutesForDistance(distanceMeters(origin, place));
}

// 15분 안인지 (R2). 도보 시간을 모르는 가게는 뺀다
function isWithinWalk(minutes) {
  return Number.isFinite(minutes) && minutes <= MAX_WALK_MINUTES;
}

// 카카오 분류 "음식점 > 한식 > 국밥"에서 둘째 단계("한식")만 쓴다 (#21).
// 단계가 하나뿐이면 그것을 쓴다
function shortCategory(category) {
  const parts = String(category || '')
    .split('>')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts[1] || parts[0] || '';
}

// 가게 태그 = 그 가게의 한 줄 추천에 한 번이라도 나온 태그 (R3). 처음 나온 순서대로, 겹치지 않게.
// 숨긴 글(R15)의 태그는 넣지 않는다
function placeTags(reviews) {
  const tags = [];
  for (const review of Array.isArray(reviews) ? reviews : []) {
    if (!review || review.hidden || !Array.isArray(review.tags)) {
      continue;
    }
    for (const tag of review.tags) {
      if (typeof tag === 'string' && !tags.includes(tag)) {
        tags.push(tag);
      }
    }
  }
  return tags;
}

// 주소 쿼리를 필터 값으로 바꾼다.
//   성공: { ok: true, value: { maxPrice, category, tags } }
//   실패: { ok: false, error }
// 쿼리는 모두 선택이다. 안 보낸 값은 maxPrice null, category '', tags []
function parseFilter(query) {
  const q = query || {};

  let maxPrice = null;
  if (q.maxPrice !== undefined) {
    // ?maxPrice=1&maxPrice=2 처럼 여러 번 보내면 배열로 오므로 문자열만 받는다.
    // "8000"처럼 숫자만 받는다. "8,000"이나 "8천"은 화면에서 숫자로 바꿔서 보낸다. 빈 값은 안 보낸 것으로 본다
    const raw = typeof q.maxPrice === 'string' ? q.maxPrice.trim() : null;
    if (raw === null || (raw !== '' && !/^\d+$/.test(raw))) {
      return { ok: false, error: '가격 상한은 숫자로 보내 주세요.' };
    }
    if (raw !== '') {
      maxPrice = Number(raw);
    }
  }

  const category = typeof q.category === 'string' ? q.category.trim() : '';

  const tags = [];
  if (typeof q.tags === 'string') {
    for (const tag of q.tags.split(',')) {
      const trimmed = tag.trim();
      if (trimmed !== '' && !tags.includes(trimmed)) {
        tags.push(trimmed);
      }
    }
  }

  return { ok: true, value: { maxPrice, category, tags } };
}

// 가게가 필터에 맞는지 (R3)
//   가격 상한: averagePrice가 상한 이하. 가격 기록이 없는 가게(null)는 가격 상한을 걸면 빠진다
//   음식 종류: 분류의 둘째 단계가 같아야 한다
//   태그: 고른 태그가 모두 그 가게 태그에 있어야 한다
function matchesFilter(place, filter) {
  if (filter.maxPrice !== null) {
    if (!Number.isFinite(place.averagePrice) || place.averagePrice > filter.maxPrice) {
      return false;
    }
  }

  if (filter.category !== '' && shortCategory(place.category) !== filter.category) {
    return false;
  }

  const placeTagList = Array.isArray(place.tags) ? place.tags : [];
  for (const tag of filter.tags) {
    if (!placeTagList.includes(tag)) {
      return false;
    }
  }

  return true;
}

module.exports = {
  SCHOOL,
  WALK_METERS_PER_MINUTE,
  MAX_WALK_MINUTES,
  distanceMeters,
  minutesForDistance,
  walkMinutes,
  isWithinWalk,
  shortCategory,
  placeTags,
  parseFilter,
  matchesFilter,
};