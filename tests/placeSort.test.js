const test = require('node:test');
const assert = require('node:assert');

const { sortPlaces } = require('../shared/placeSort');

// 가게를 쉽게 만들기. 예: placeOf('가', 80, 5)
function placeOf(name, againRatio, walkMinutes) {
  return { name, againRatio, walkMinutes };
}

function namesOf(places) {
  return places.map((place) => place.name);
}

test('또 갈래요 비율이 높은 가게가 앞에 온다', () => {
  const sorted = sortPlaces([placeOf('육십', 60, 3), placeOf('팔십', 80, 10)]);
  assert.deepStrictEqual(namesOf(sorted), ['팔십', '육십']);
});

test('비율이 같으면 도보 시간이 짧은 가게가 앞에 온다', () => {
  const sorted = sortPlaces([placeOf('십분', 70, 10), placeOf('오분', 70, 5)]);
  assert.deepStrictEqual(namesOf(sorted), ['오분', '십분']);
});

test('기록 부족인 가게는 비율 0%보다도 뒤에 온다', () => {
  const sorted = sortPlaces([placeOf('부족', null, 1), placeOf('영', 0, 15)]);
  assert.deepStrictEqual(namesOf(sorted), ['영', '부족']);
});

test('기록 부족인 가게끼리는 도보 시간이 짧은 순이다', () => {
  const sorted = sortPlaces([placeOf('먼부족', null, 12), placeOf('가까운부족', null, 2)]);
  assert.deepStrictEqual(namesOf(sorted), ['가까운부족', '먼부족']);
});

test('비율과 도보 시간이 같으면 가게 이름순이다', () => {
  const sorted = sortPlaces([placeOf('하이레', 50, 4), placeOf('가람', 50, 4)]);
  assert.deepStrictEqual(namesOf(sorted), ['가람', '하이레']);
});

test('여러 조건이 섞여도 규칙대로 정렬된다', () => {
  const sorted = sortPlaces([
    placeOf('부족-먼', null, 9),
    placeOf('70-10분', 70, 10),
    placeOf('100', 100, 14),
    placeOf('부족-가까운', null, 1),
    placeOf('70-5분', 70, 5),
    placeOf('0', 0, 1),
  ]);
  assert.deepStrictEqual(namesOf(sorted), ['100', '70-5분', '70-10분', '0', '부족-가까운', '부족-먼']);
});

test('받은 배열은 바꾸지 않는다', () => {
  const places = [placeOf('육십', 60, 3), placeOf('팔십', 80, 10)];
  sortPlaces(places);
  assert.deepStrictEqual(namesOf(places), ['육십', '팔십']);
});

test('도보 시간을 모르는 가게는 같은 비율에서 뒤로 간다', () => {
  const sorted = sortPlaces([placeOf('모름', 50, null), placeOf('앎', 50, 14)]);
  assert.deepStrictEqual(namesOf(sorted), ['앎', '모름']);
});

test('빈 목록이나 배열이 아닌 값이면 빈 배열을 돌려준다', () => {
  assert.deepStrictEqual(sortPlaces([]), []);
  assert.deepStrictEqual(sortPlaces(undefined), []);
});