// 오늘의 추천. 첫 화면에 가게 하나를 골라 보여 준다.
// 고르는 것은 규칙이 한다. R5 순서(또 갈래요 비율이 높은 순)의 앞쪽 가게 몇 곳을 후보로 두고,
// 날짜에 따라 그중 하나를 고른다. 같은 날에는 누구에게나 같은 가게가 나오고, 날이 바뀌면 다음 후보로 넘어간다.
// LLM은 가게를 고르지 않는다. 고른 가게의 한 줄 요약(shared/placeSummary.js)을 같이 보여 줄 뿐이다.

// 후보로 두는 가게 수
const MAX_CANDIDATES = 5;
// 또 갈래요 비율이 이보다 낮은 가게는 추천하지 않는다
const MIN_AGAIN_RATIO = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

// 후보를 고른다. sortedPlaces는 R5 순서로 정렬된 가게 목록이다.
// 또 갈래요 비율이 50% 이상인 가게가 있으면 그 앞쪽 5곳,
// 없으면 비율이 아직 없는("기록 부족") 가게 중 한 줄 추천이 있는 앞쪽 5곳
function pickCandidates(sortedPlaces) {
  const places = Array.isArray(sortedPlaces) ? sortedPlaces : [];
  const liked = places.filter((place) => Number.isFinite(place.againRatio) && place.againRatio >= MIN_AGAIN_RATIO);
  if (liked.length > 0) {
    return liked.slice(0, MAX_CANDIDATES);
  }
  return places
    .filter((place) => !Number.isFinite(place.againRatio) && place.reviewCount > 0)
    .slice(0, MAX_CANDIDATES);
}

// 날짜("2026-11-26")를 후보 번호로 바꾼다. 하루가 지나면 번호가 1 늘고, 끝까지 가면 처음으로 돌아온다
function dayIndex(day, count) {
  const time = Date.parse(String(day) + 'T00:00:00Z');
  if (!Number.isInteger(count) || count <= 0 || Number.isNaN(time)) {
    return 0;
  }
  return Math.floor(time / DAY_MS) % count;
}

// 오늘의 가게를 고른다. 후보가 없으면 null
function pickToday(sortedPlaces, day) {
  const candidates = pickCandidates(sortedPlaces);
  if (candidates.length === 0) {
    return null;
  }
  return candidates[dayIndex(day, candidates.length)];
}

// 고른 이유를 숫자로 적은 한 줄. 예: "또 갈래요 82%, 걸어서 5분, 1인 약 8,000원"
function reasonText(place) {
  if (!place) {
    return '';
  }
  const parts = [];
  if (Number.isFinite(place.againRatio)) {
    parts.push('또 갈래요 ' + place.againRatio + '%');
  }
  if (Number.isFinite(place.walkMinutes)) {
    parts.push('걸어서 ' + place.walkMinutes + '분');
  }
  if (Number.isFinite(place.averagePrice)) {
    parts.push('1인 약 ' + place.averagePrice.toLocaleString('ko-KR') + '원');
  }
  return parts.join(', ');
}

module.exports = {
  MAX_CANDIDATES,
  MIN_AGAIN_RATIO,
  pickCandidates,
  dayIndex,
  pickToday,
  reasonText,
};
