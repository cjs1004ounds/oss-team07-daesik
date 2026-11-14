const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeQuery,
  isFresh,
  getCached,
  setCached,
} = require('../shared/searchCache');

const MINUTE = 60 * 1000;
const START = 1000000; // 저장한 시각으로 쓰는 임의의 값
const RESULTS = [{ id: '1', name: '테스트식당' }];

// 검색어 정리

test('검색어의 앞뒤 공백과 중간의 여러 공백을 정리한다', () => {
  assert.strictEqual(normalizeQuery('  광운대   제육 '), '광운대 제육');
});

test('영문 대소문자가 달라도 같은 검색어로 본다', () => {
  assert.strictEqual(normalizeQuery('Pizza'), normalizeQuery('pizza'));
});

test('문자열이 아닌 검색어는 빈 문자열이 된다', () => {
  assert.strictEqual(normalizeQuery(undefined), '');
  assert.strictEqual(normalizeQuery(null), '');
  assert.strictEqual(normalizeQuery(123), '');
  assert.strictEqual(normalizeQuery(['제육']), '');
});

// 10분 기준

test('저장한 직후와 9분 59초 뒤는 아직 유효하다', () => {
  assert.strictEqual(isFresh(START, START), true);
  assert.strictEqual(isFresh(START, START + 10 * MINUTE - 1000), true);
});

test('정확히 10분이 되면 만료다', () => {
  assert.strictEqual(isFresh(START, START + 10 * MINUTE), false);
});

test('10분을 넘으면 만료다', () => {
  assert.strictEqual(isFresh(START, START + 11 * MINUTE), false);
});

test('저장 시각이 지금보다 미래면 유효하지 않다', () => {
  assert.strictEqual(isFresh(START, START - 1), false);
});

// 저장하고 꺼내기

test('저장한 적 없는 검색어는 null이다', () => {
  const cache = new Map();
  assert.strictEqual(getCached(cache, '제육', START), null);
});

test('10분 안에 같은 검색어를 찾으면 저장해 둔 결과가 나온다', () => {
  const cache = new Map();
  setCached(cache, '제육', RESULTS, START);

  assert.deepStrictEqual(getCached(cache, '제육', START + 5 * MINUTE), RESULTS);
});

test('공백만 다르게 쓴 검색어도 저장해 둔 결과가 나온다', () => {
  const cache = new Map();
  setCached(cache, '광운대 제육', RESULTS, START);

  assert.deepStrictEqual(getCached(cache, ' 광운대  제육 ', START + MINUTE), RESULTS);
});

test('10분이 지나면 null이고 저장된 것도 지워진다', () => {
  const cache = new Map();
  setCached(cache, '제육', RESULTS, START);

  assert.strictEqual(getCached(cache, '제육', START + 10 * MINUTE), null);
  assert.strictEqual(cache.size, 0);
});

test('결과가 빈 배열이어도 저장해 둔 것으로 돌려준다', () => {
  const cache = new Map();
  setCached(cache, '없는가게', [], START);

  assert.deepStrictEqual(getCached(cache, '없는가게', START + MINUTE), []);
});

test('빈 검색어는 저장하지 않고, 찾아도 null이다', () => {
  const cache = new Map();
  setCached(cache, '   ', RESULTS, START);

  assert.strictEqual(cache.size, 0);
  assert.strictEqual(getCached(cache, '', START), null);
});

test('새로 저장할 때 10분 지난 다른 검색어는 지운다', () => {
  const cache = new Map();
  setCached(cache, '제육', RESULTS, START);
  setCached(cache, '돈까스', RESULTS, START + 20 * MINUTE);

  assert.strictEqual(cache.size, 1);
  assert.strictEqual(getCached(cache, '돈까스', START + 20 * MINUTE), RESULTS);
});
