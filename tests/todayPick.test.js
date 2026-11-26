const test = require('node:test');
const assert = require('node:assert');

const { MAX_CANDIDATES, MIN_AGAIN_RATIO, pickCandidates, dayIndex, pickToday, reasonText } = require('../shared/todayPick');

function place(name, againRatio, reviewCount) {
  return { id: name, name: name, againRatio: againRatio, reviewCount: reviewCount === undefined ? 1 : reviewCount };
}

test(`또 갈래요 비율이 ${MIN_AGAIN_RATIO}% 이상인 가게만 후보가 된다`, () => {
  const candidates = pickCandidates([place('가', 90), place('나', MIN_AGAIN_RATIO), place('다', MIN_AGAIN_RATIO - 1), place('라', null)]);
  assert.deepStrictEqual(candidates.map((p) => p.name), ['가', '나']);
});

test(`후보는 앞에서 ${MAX_CANDIDATES}곳까지다`, () => {
  const many = Array.from({ length: MAX_CANDIDATES + 3 }, (_, i) => place('가게' + i, 100 - i));
  const candidates = pickCandidates(many);
  assert.strictEqual(candidates.length, MAX_CANDIDATES);
  assert.strictEqual(candidates[0].name, '가게0');
});

test('비율이 있는 가게가 없으면 한 줄 추천이 있는 기록 부족 가게가 후보다', () => {
  const candidates = pickCandidates([place('추천 있음', null, 2), place('다녀왔어요만', null, 0)]);
  assert.deepStrictEqual(candidates.map((p) => p.name), ['추천 있음']);
});

test('비율이 낮은 가게만 있으면 그 가게는 추천하지 않는다', () => {
  assert.deepStrictEqual(pickCandidates([place('별로', 20)]), []);
  assert.strictEqual(pickToday([place('별로', 20)], '2026-11-26'), null);
});

test('가게가 없거나 배열이 아니면 후보가 없다', () => {
  assert.deepStrictEqual(pickCandidates([]), []);
  assert.deepStrictEqual(pickCandidates(null), []);
  assert.strictEqual(pickToday([], '2026-11-26'), null);
});

test('같은 날에는 같은 가게가 나온다', () => {
  const places = [place('가', 90), place('나', 80), place('다', 70)];
  assert.strictEqual(pickToday(places, '2026-11-26'), pickToday(places, '2026-11-26'));
});

test('날이 바뀌면 다음 후보로 넘어가고, 끝까지 가면 처음으로 돌아온다', () => {
  const places = [place('가', 90), place('나', 80), place('다', 70)];
  const names = ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'].map((day) => pickToday(places, day).name);
  assert.strictEqual(new Set(names.slice(0, 3)).size, 3);
  assert.strictEqual(names[3], names[0]);
});

test('날짜가 이상하거나 후보 수가 0이면 번호는 0이다', () => {
  assert.strictEqual(dayIndex('오늘', 3), 0);
  assert.strictEqual(dayIndex('2026-11-26', 0), 0);
  assert.ok(dayIndex('2026-11-26', 3) >= 0 && dayIndex('2026-11-26', 3) < 3);
});

test('고른 이유는 있는 숫자만 쉼표로 이어 적는다', () => {
  assert.strictEqual(
    reasonText({ againRatio: 82, walkMinutes: 5, averagePrice: 8000 }),
    '또 갈래요 82%, 걸어서 5분, 1인 약 8,000원'
  );
  assert.strictEqual(reasonText({ againRatio: null, walkMinutes: 3, averagePrice: null }), '걸어서 3분');
  assert.strictEqual(reasonText(null), '');
});
