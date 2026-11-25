const test = require('node:test');
const assert = require('node:assert');

const {
  SCHOOL,
  distanceMeters,
  minutesForDistance,
  walkMinutes,
  isWithinWalk,
  shortCategory,
  placeTags,
  parseFilter,
  matchesFilter,
} = require('../shared/placeFilter');

// 필터를 쉽게 만들기. 예: filterOf({ maxPrice: 8000 })
function filterOf(values) {
  return { maxPrice: null, category: '', tags: [], ...values };
}

// R1 도보 시간

test('같은 자리는 거리가 0이다', () => {
  assert.strictEqual(distanceMeters(SCHOOL, SCHOOL), 0);
});

test('위도 1도는 약 111km다', () => {
  const meters = distanceMeters({ lat: 37, lng: 127 }, { lat: 38, lng: 127 });
  assert.ok(Math.abs(meters - 111195) < 10);
});

test('도보 시간은 67m에 1분으로 계산하고 올린다', () => {
  assert.strictEqual(minutesForDistance(67), 1);
  assert.strictEqual(minutesForDistance(68), 2);
  assert.strictEqual(minutesForDistance(1), 1);
  assert.strictEqual(minutesForDistance(0), 0);
});

test('1,005m는 15분, 1,006m는 16분이다', () => {
  assert.strictEqual(minutesForDistance(1005), 15);
  assert.strictEqual(minutesForDistance(1006), 16);
});

test('학교 바로 앞 가게는 몇 분 안으로 나온다', () => {
  // 학교에서 북동쪽으로 약 170m
  assert.strictEqual(walkMinutes({ lat: 37.62, lng: 127.06 }), 3);
});

test('좌표가 숫자가 아니면 도보 시간은 null이다', () => {
  assert.strictEqual(walkMinutes({ lat: '37.62', lng: 127.06 }), null);
  assert.strictEqual(walkMinutes({ lat: 37.62 }), null);
  assert.strictEqual(walkMinutes(null), null);
});

// R2 15분 제외

test('15분은 남기고 16분은 뺀다', () => {
  assert.strictEqual(isWithinWalk(15), true);
  assert.strictEqual(isWithinWalk(16), false);
  assert.strictEqual(isWithinWalk(0), true);
});

test('도보 시간을 모르면 뺀다', () => {
  assert.strictEqual(isWithinWalk(null), false);
});

// R3 음식 종류와 태그

test('음식 종류는 분류의 둘째 단계를 쓴다', () => {
  assert.strictEqual(shortCategory('음식점 > 한식 > 국밥 > 더진국'), '한식');
  assert.strictEqual(shortCategory('음식점 > 일식'), '일식');
});

test('분류가 한 단계뿐이거나 비어 있어도 오류가 나지 않는다', () => {
  assert.strictEqual(shortCategory('음식점'), '음식점');
  assert.strictEqual(shortCategory(''), '');
  assert.strictEqual(shortCategory(undefined), '');
});

test('가게 태그는 추천에 나온 태그를 겹치지 않게 모은다', () => {
  const reviews = [{ tags: ['혼밥', '양 많음'] }, { tags: ['혼밥', '가성비'] }, { tags: [] }];
  assert.deepStrictEqual(placeTags(reviews), ['혼밥', '양 많음', '가성비']);
});

test('숨긴 글의 태그는 가게 태그에 넣지 않는다', () => {
  const reviews = [{ tags: ['혼밥'] }, { tags: ['매움'], hidden: true }];
  assert.deepStrictEqual(placeTags(reviews), ['혼밥']);
});

// R3 쿼리 읽기

test('쿼리가 없으면 거르지 않는 필터가 된다', () => {
  assert.deepStrictEqual(parseFilter({}), { ok: true, value: filterOf({}) });
  assert.deepStrictEqual(parseFilter(undefined), { ok: true, value: filterOf({}) });
});

test('가격 상한, 음식 종류, 태그를 읽는다', () => {
  const result = parseFilter({ maxPrice: '8000', category: '한식', tags: '혼밥, 가성비' });
  assert.deepStrictEqual(result, {
    ok: true,
    value: { maxPrice: 8000, category: '한식', tags: ['혼밥', '가성비'] },
  });
});

test('빈 값과 겹친 태그는 무시한다', () => {
  const result = parseFilter({ maxPrice: '', category: ' ', tags: '혼밥,,혼밥,' });
  assert.deepStrictEqual(result, { ok: true, value: filterOf({ tags: ['혼밥'] }) });
});

test('가격 상한이 숫자가 아니면 거절한다', () => {
  for (const maxPrice of ['8,000', '8천', '-100', '1.5', 'abc', ['1', '2']]) {
    const result = parseFilter({ maxPrice });
    assert.strictEqual(result.ok, false, `${maxPrice}는 거절해야 한다`);
    assert.strictEqual(typeof result.error, 'string');
  }
});

// R3 거르기

const place = {
  category: '음식점 > 한식 > 국밥',
  averagePrice: 8000,
  tags: ['혼밥', '가성비', '양 많음'],
};

test('필터가 비어 있으면 모두 남는다', () => {
  assert.strictEqual(matchesFilter(place, filterOf({})), true);
  assert.strictEqual(matchesFilter({ category: '', averagePrice: null, tags: [] }, filterOf({})), true);
});

test('평균 가격이 상한과 같으면 남고, 넘으면 빠진다', () => {
  assert.strictEqual(matchesFilter(place, filterOf({ maxPrice: 8000 })), true);
  assert.strictEqual(matchesFilter(place, filterOf({ maxPrice: 7900 })), false);
});

test('가격 기록이 없는 가게는 가격 상한을 걸면 빠진다', () => {
  const noPrice = { ...place, averagePrice: null };
  assert.strictEqual(matchesFilter(noPrice, filterOf({ maxPrice: 100000 })), false);
  assert.strictEqual(matchesFilter(noPrice, filterOf({})), true);
});

test('음식 종류는 둘째 단계가 같아야 남는다', () => {
  assert.strictEqual(matchesFilter(place, filterOf({ category: '한식' })), true);
  assert.strictEqual(matchesFilter(place, filterOf({ category: '일식' })), false);
  assert.strictEqual(matchesFilter(place, filterOf({ category: '국밥' })), false);
});

test('태그를 여러 개 고르면 모두 있어야 남는다', () => {
  assert.strictEqual(matchesFilter(place, filterOf({ tags: ['혼밥', '가성비'] })), true);
  assert.strictEqual(matchesFilter(place, filterOf({ tags: ['혼밥', '매움'] })), false);
});

test('조건을 모두 걸면 하나라도 안 맞을 때 빠진다', () => {
  const all = filterOf({ maxPrice: 9000, category: '한식', tags: ['혼밥'] });
  assert.strictEqual(matchesFilter(place, all), true);
  assert.strictEqual(matchesFilter({ ...place, averagePrice: 9500 }, all), false);
});