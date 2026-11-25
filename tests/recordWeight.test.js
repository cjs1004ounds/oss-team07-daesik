const test = require('node:test');
const assert = require('node:assert');

const {
  HALF_LIFE_DAYS,
  MAX_AGE_DAYS,
  recordWeight,
  againStats,
  averagePrice,
  lastRecordAt,
} = require('../shared/recordWeight');

const NOW = new Date('2026-11-25T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

// 지금부터 days일 전 시각
function daysAgo(days) {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function visit(again, days, verified = true) {
  return { again: again, verified: verified, createdAt: daysAgo(days) };
}

function review(price, days, hidden = false) {
  return { price: price, hidden: hidden, createdAt: daysAgo(days) };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual}이(가) ${expected}에 가깝지 않음`);
}

// 무게

test('오늘 기록은 무게 1, 90일 전은 0.5, 180일 전은 0.25다', () => {
  near(recordWeight(daysAgo(0), NOW), 1);
  near(recordWeight(daysAgo(HALF_LIFE_DAYS), NOW), 0.5);
  near(recordWeight(daysAgo(HALF_LIFE_DAYS * 2), NOW), 0.25);
});

test(`${MAX_AGE_DAYS}일 바로 전까지는 넣고 ${MAX_AGE_DAYS}일이 되면 무게가 0이다`, () => {
  assert.ok(recordWeight(daysAgo(MAX_AGE_DAYS - 1), NOW) > 0);
  assert.strictEqual(recordWeight(daysAgo(MAX_AGE_DAYS), NOW), 0);
  assert.strictEqual(recordWeight(daysAgo(800), NOW), 0);
});

test('미래 시각으로 저장된 기록은 오늘 기록으로 보고, 잘못된 시각은 0이다', () => {
  near(recordWeight(daysAgo(-3), NOW), 1);
  assert.strictEqual(recordWeight('어제', NOW), 0);
  assert.strictEqual(recordWeight(undefined, NOW), 0);
});

// 또 갈래요 비율

test('모두 오늘이면 그냥 비율과 같다', () => {
  const stats = againStats([visit(true, 0), visit(true, 0), visit(false, 0), visit(true, 0)], NOW);
  assert.deepStrictEqual(stats, { responseCount: 4, againRatio: 75 });
});

test('또 갈래요와 글쎄요 수가 같아도 최근 쪽이 또 갈래요면 50%보다 높다', () => {
  const recentGood = againStats([visit(true, 0), visit(true, 1), visit(false, 200), visit(false, 210)], NOW);
  const recentBad = againStats([visit(false, 0), visit(false, 1), visit(true, 200), visit(true, 210)], NOW);
  assert.ok(recentGood.againRatio > 50);
  assert.ok(recentBad.againRatio < 50);
});

test('90일 전 응답은 오늘 응답의 절반만큼 들어간다', () => {
  // 오늘 또 갈래요 2개(무게 2), 90일 전 글쎄요 2개(무게 1) -> 2 / 3 = 67%
  const stats = againStats([visit(true, 0), visit(true, 0), visit(false, 90), visit(false, 90)], NOW);
  assert.strictEqual(stats.againRatio, 67);
});

test('교내 인증되지 않은 응답은 넣지 않는다 (R14)', () => {
  const stats = againStats([visit(true, 0), visit(true, 0), visit(false, 0, false), visit(false, 0, false)], NOW);
  assert.deepStrictEqual(stats, { responseCount: 2, againRatio: null });
});

test('넣을 응답이 3개보다 적으면 비율은 null(기록 부족)이다', () => {
  assert.deepStrictEqual(againStats([visit(true, 0), visit(false, 0)], NOW), { responseCount: 2, againRatio: null });
  assert.deepStrictEqual(againStats([], NOW), { responseCount: 0, againRatio: null });
});

test('1년이 지난 응답은 수에도 비율에도 들어가지 않는다', () => {
  const stats = againStats([visit(true, 0), visit(true, 0), visit(true, 0), visit(false, 400), visit(false, 500)], NOW);
  assert.deepStrictEqual(stats, { responseCount: 3, againRatio: 100 });
});

test('모양이 잘못된 응답은 건너뛴다', () => {
  const stats = againStats([null, { verified: true, again: 'yes', createdAt: daysAgo(0) }, visit(true, 0)], NOW);
  assert.strictEqual(stats.responseCount, 1);
  assert.deepStrictEqual(againStats(undefined, NOW), { responseCount: 0, againRatio: null });
});

// 1인 가격 평균

test('가격 평균은 최근 가격에 더 가깝게 나오고 100원 단위로 반올림한다', () => {
  // 오늘 9,000원(무게 1), 90일 전 6,000원(무게 0.5) -> (9000 + 3000) / 1.5 = 8,000원
  assert.strictEqual(averagePrice([review(9000, 0), review(6000, 90)], NOW), 8000);
  assert.strictEqual(averagePrice([review(7050, 0)], NOW), 7100);
});

test('가격이 없거나 숨긴 글, 1년 지난 글은 가격 평균에서 뺀다', () => {
  assert.strictEqual(averagePrice([review(null, 0), review(8000, 0), review(20000, 0, true), review(3000, 400)], NOW), 8000);
});

test('넣을 가격이 하나도 없으면 null이다', () => {
  assert.strictEqual(averagePrice([review(null, 0), review(5000, 400)], NOW), null);
  assert.strictEqual(averagePrice(undefined, NOW), null);
});

// 마지막 기록

test('가장 최근 기록의 시각을 돌려주고 숨긴 글은 뺀다', () => {
  const records = [review(7000, 10), review(7000, 2, true), visit(true, 5), { createdAt: '잘못된 시각' }];
  assert.strictEqual(lastRecordAt(records), daysAgo(5));
  assert.strictEqual(lastRecordAt([]), null);
  assert.strictEqual(lastRecordAt(undefined), null);
});
