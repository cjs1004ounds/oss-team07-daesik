// R5 가게 목록 정렬.
//
//   1. 또 갈래요 비율(againRatio)이 높은 순
//   2. 비율이 같으면 도보 시간(walkMinutes)이 짧은 순
//   3. "기록 부족"(againRatio가 null)인 가게는 맨 뒤. 그 안에서는 도보 시간이 짧은 순
//   4. 비율과 도보 시간이 모두 같으면 가게 이름순. 새로고침할 때마다 순서가 바뀌지 않게 하려는 것이다
//
// 3의 "그 안에서"와 4는 README에 없어서 #115에서 정한 것이다.
//
// 쓰는 가게 값의 모양
//   { name, againRatio, walkMinutes }
//   againRatio는 shared/recordWeight.js의 againStats(R14 가중치), walkMinutes는 shared/placeFilter.js(R1) 값이다

// 비율이 있는지. 0%도 비율이 있는 것이다
function hasRatio(place) {
  return Number.isFinite(place.againRatio);
}

// 도보 시간을 모르면 가장 먼 것으로 본다
function walkOf(place) {
  return Number.isFinite(place.walkMinutes) ? place.walkMinutes : Infinity;
}

// 두 가게의 순서. 앞에 와야 하는 쪽이 음수
function comparePlaces(a, b) {
  const aHas = hasRatio(a);
  const bHas = hasRatio(b);

  // 기록 부족은 맨 뒤
  if (aHas !== bHas) {
    return aHas ? -1 : 1;
  }

  // 비율이 높은 순
  if (aHas && a.againRatio !== b.againRatio) {
    return b.againRatio - a.againRatio;
  }

  // 도보 시간이 짧은 순
  if (walkOf(a) !== walkOf(b)) {
    return walkOf(a) < walkOf(b) ? -1 : 1;
  }

  // 가게 이름순
  return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
}

// 정렬한 새 배열을 돌려준다. 받은 배열은 바꾸지 않는다
function sortPlaces(places) {
  return [...(Array.isArray(places) ? places : [])].sort(comparePlaces);
}

module.exports = {
  comparePlaces,
  sortPlaces,
};