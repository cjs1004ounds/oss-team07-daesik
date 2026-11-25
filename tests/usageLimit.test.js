const test = require('node:test');
const assert = require('node:assert');

const { take, cleanUp, koreaDay } = require('../shared/usageLimit');

const HOUR = 60 * 60 * 1000;

test('한도까지는 쓰고 넘으면 막는다', () => {
  const counters = new Map();
  assert.deepStrictEqual(take(counters, 'a', 2, HOUR, 0), { ok: true, remaining: 1 });
  assert.deepStrictEqual(take(counters, 'a', 2, HOUR, 10), { ok: true, remaining: 0 });
  assert.deepStrictEqual(take(counters, 'a', 2, HOUR, 20), { ok: false, remaining: 0 });
});

test('key가 다르면 따로 센다', () => {
  const counters = new Map();
  take(counters, 'a', 1, HOUR, 0);
  assert.strictEqual(take(counters, 'a', 1, HOUR, 0).ok, false);
  assert.strictEqual(take(counters, 'b', 1, HOUR, 0).ok, true);
});

test('창이 지나면 새로 센다. 창이 끝나는 순간부터 새 창이다', () => {
  const counters = new Map();
  take(counters, 'a', 1, HOUR, 0);
  assert.strictEqual(take(counters, 'a', 1, HOUR, HOUR - 1).ok, false);
  assert.strictEqual(take(counters, 'a', 1, HOUR, HOUR).ok, true);
});

test('시계가 뒤로 가면 새로 센다', () => {
  const counters = new Map();
  take(counters, 'a', 1, HOUR, 1000);
  assert.strictEqual(take(counters, 'a', 1, HOUR, 500).ok, true);
});

test('한도가 0이거나 정수가 아니면 늘 막는다', () => {
  const counters = new Map();
  assert.strictEqual(take(counters, 'a', 0, HOUR, 0).ok, false);
  assert.strictEqual(take(counters, 'a', 1.5, HOUR, 0).ok, false);
  assert.strictEqual(take(counters, 'a', undefined, HOUR, 0).ok, false);
});

test('지난 창은 지우고 아직 살아 있는 창은 남긴다', () => {
  const counters = new Map();
  take(counters, 'old', 5, HOUR, 0);
  take(counters, 'new', 5, HOUR, HOUR);
  cleanUp(counters, HOUR, HOUR + 10);
  assert.deepStrictEqual([...counters.keys()], ['new']);
});

test('한국 시간 날짜를 돌려준다. UTC 15시가 한국 0시다', () => {
  assert.strictEqual(koreaDay(Date.parse('2026-11-25T14:59:59.999Z')), '2026-11-25');
  assert.strictEqual(koreaDay(Date.parse('2026-11-25T15:00:00.000Z')), '2026-11-26');
});
