const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parsePricesFromText,
  checkPrice,
  findHeldPrices,
  needsCategoryRange,
  categoryKey,
  buildRangePrompt,
  parseRange,
  holdMessage,
} = require('../shared/priceCheck');

// 글에서 가격 읽기

test('여러 모양으로 적힌 가격을 읽는다', () => {
  assert.deepStrictEqual(parsePricesFromText('제육 7천원인데 양 많음'), [7000]);
  assert.deepStrictEqual(parsePricesFromText('7천5백원'), [7500]);
  assert.deepStrictEqual(parsePricesFromText('정식 1만2천원'), [12000]);
  assert.deepStrictEqual(parsePricesFromText('코스 2만원'), [20000]);
  assert.deepStrictEqual(parsePricesFromText('만원이면 충분'), [10000]);
  assert.deepStrictEqual(parsePricesFromText('12,000원'), [12000]);
  assert.deepStrictEqual(parsePricesFromText('8000원'), [8000]);
  assert.deepStrictEqual(parsePricesFromText('제육 7000 양 많음'), [7000]);
});

test('가격이 여러 개면 나온 순서대로 돌려준다', () => {
  assert.deepStrictEqual(parsePricesFromText('돈까스 9천 제육 7천'), [9000, 7000]);
});

test('날짜, 전화번호, 호수, 거리 같은 숫자는 가격으로 읽지 않는다', () => {
  for (const text of ['2026년 11월에 감', '010-1234-5678', '방 2025호', '3천m 걸어감', '2천명 줄 섬', '만족스러움', '학번 2021123456']) {
    assert.deepStrictEqual(parsePricesFromText(text), [], text);
  }
});

test('1,000원보다 작거나 100,000원보다 큰 값은 읽지 않는다', () => {
  assert.deepStrictEqual(parsePricesFromText('500원 추가'), []);
  assert.deepStrictEqual(parsePricesFromText('20만원 회식'), []);
});

// 가격 하나 검사

test('글에 적힌 가격과 가격 칸이 크게 다르면 보류하고 글의 가격을 제안한다', () => {
  assert.deepStrictEqual(checkPrice(99999, '제육 7천원인데 양 많고 혼밥하기 좋음', [], null), {
    reason: 'text',
    suggestedPrice: 7000,
  });
});

test('글의 가격과 30% 안으로 비슷하면 괜찮다', () => {
  assert.strictEqual(checkPrice(7000, '제육 7천원', [], null), null);
  assert.strictEqual(checkPrice(9000, '제육 7천원', [], null), null);
  assert.strictEqual(checkPrice(9200, '제육 7천원', [], null).reason, 'text');
});

test('글에 가격이 여러 개면 하나라도 비슷하면 괜찮고, 다 다르면 제안 없이 보류한다', () => {
  assert.strictEqual(checkPrice(9000, '돈까스 9천 제육 7천', [], null), null);
  assert.deepStrictEqual(checkPrice(50000, '돈까스 9천 제육 7천', [], null), { reason: 'text', suggestedPrice: null });
});

test('글이 가격을 뒷받침하면 다른 기록이나 보통 범위와 달라도 보류하지 않는다', () => {
  assert.strictEqual(checkPrice(30000, '코스 3만원', [8000, 9000], { min: 8000, max: 13000 }), null);
});

test('같은 가게의 다른 가격 중간값보다 2.5배 넘게 크거나 작으면 보류한다', () => {
  assert.deepStrictEqual(checkPrice(30000, '맛있음', [8000, 9000], null), { reason: 'peers', expected: 8500 });
  assert.strictEqual(checkPrice(3000, '맛있음', [8000, 9000], null).reason, 'peers');
  assert.strictEqual(checkPrice(20000, '맛있음', [8000, 9000], null), null);
});

test('다른 가격이 2개보다 적으면 다른 기록과는 비교하지 않는다', () => {
  assert.strictEqual(checkPrice(30000, '맛있음', [8000], null), null);
});

test('보통 범위의 절반보다 작거나 두 배보다 크면 보류한다', () => {
  const range = { min: 8000, max: 13000 };
  assert.deepStrictEqual(checkPrice(99000, '맛있음', [], range), { reason: 'category', range: range });
  assert.strictEqual(checkPrice(3000, '맛있음', [], range).reason, 'category');
  assert.strictEqual(checkPrice(26000, '맛있음', [], range), null);
  assert.strictEqual(checkPrice(4000, '맛있음', [], range), null);
});

test('가격이 없으면 검사하지 않는다', () => {
  assert.strictEqual(checkPrice(null, '제육 7천원', [8000, 9000], { min: 8000, max: 13000 }), null);
  assert.strictEqual(checkPrice(undefined, '', [], null), null);
});

// 가게 하나의 추천들

function review(id, text, price, extra = {}) {
  return { id: id, text: text, price: price, ...extra };
}

test('한 가게의 추천에서 보류할 가격만 찾는다', () => {
  const reviews = [review('a', '제육 7천원', 99999), review('b', '맛있음', 8000), review('c', '양 많음', 9000), review('d', '비쌈', 40000)];
  const held = findHeldPrices(reviews, null);
  assert.deepStrictEqual([...held.keys()], ['a', 'd']);
  assert.strictEqual(held.get('a').reason, 'text');
  assert.strictEqual(held.get('d').reason, 'peers');
});

test('글과 가격이 다른 추천은 다른 추천을 판단할 때 비교 대상에서 뺀다', () => {
  // 99,999원이 비교 대상에 들어가면 8,000원이 "너무 싸다"로 잘못 보류된다
  const reviews = [review('a', '제육 7천원', 99999), review('b', '맛있음', 8000), review('c', '양 많음', 9000)];
  assert.deepStrictEqual([...findHeldPrices(reviews, null).keys()], ['a']);
});

test('숨긴 글과 가격이 없는 글은 보류 대상이 아니다', () => {
  const reviews = [review('a', '제육 7천원', 99999, { hidden: true }), review('b', '가격 안 적음', null)];
  assert.strictEqual(findHeldPrices(reviews, null).size, 0);
});

test('보통 범위가 있어야 판단할 수 있는 가격이 있을 때만 범위가 필요하다', () => {
  assert.strictEqual(needsCategoryRange([review('a', '맛있음', 8000)]), true);
  assert.strictEqual(needsCategoryRange([review('a', '제육 7천원', 7000)]), false);
  assert.strictEqual(needsCategoryRange([review('a', '제육 7천원', 99999)]), false);
  assert.strictEqual(needsCategoryRange([review('a', '가격 없음', null)]), false);
  assert.strictEqual(needsCategoryRange([]), false);
});

// 보통 가격 범위

test('종류 이름은 음식점을 빼고 두 단계까지 쓴다', () => {
  assert.strictEqual(categoryKey('음식점 > 일식 > 돈까스,우동'), '일식 > 돈까스,우동');
  assert.strictEqual(categoryKey('음식점 > 한식 > 국밥 > 상호'), '한식 > 국밥');
  assert.strictEqual(categoryKey('음식점'), '');
  assert.strictEqual(categoryKey(undefined), '');
});

test('범위를 묻는 문장에 종류 이름이 <종류> 블록 안에 들어간다', () => {
  assert.ok(buildRangePrompt('일식 > 돈까스,우동').includes('<종류>\n일식 > 돈까스,우동\n</종류>'));
});

test('말이 되는 범위만 받는다', () => {
  assert.deepStrictEqual(parseRange('{"min":8000,"max":13000}'), { ok: true, value: { min: 8000, max: 13000 } });
  assert.strictEqual(parseRange('{"min":13000,"max":8000}').ok, false);
  assert.strictEqual(parseRange('{"min":1000,"max":100000}').ok, false);
  assert.strictEqual(parseRange('{"min":500,"max":5000}').ok, false);
  assert.strictEqual(parseRange('{"min":"8000","max":13000}').ok, false);
  assert.strictEqual(parseRange('8천원에서 1만3천원').ok, false);
  assert.strictEqual(parseRange('').ok, false);
});

test('보류 이유를 사람이 읽는 말로 바꾼다', () => {
  assert.strictEqual(holdMessage({ reason: 'text', suggestedPrice: 7000 }, 99999), '글에는 7,000원인데 가격 칸은 99,999원이에요.');
  assert.ok(holdMessage({ reason: 'peers', expected: 8500 }, 30000).includes('8,500원'));
  assert.ok(holdMessage({ reason: 'category', range: { min: 8000, max: 13000 } }, 99000).includes('8,000원~13,000원'));
});

// API

const app = require('../server/app');
const store = require('../server/store');
const llm = require('../server/llm');
const priceRanges = require('../server/priceRanges');

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-check-test-'));
  process.env.DATA_DIR = path.join(dataDir, 'runtime');
  process.env.SEED_DIR = path.join(dataDir, 'seed');
  store.load();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test.afterEach(() => {
  test.mock.restoreAll();
  priceRanges.resetFailures();
});

function addPlace(id, category) {
  store.addPlace({ id: id, name: '가격식당' + id, lat: 37.6195, lng: 127.059, category: category });
}

function addReview(placeId, text, price) {
  return store.addReview({ placeId: placeId, text: text, price: price, tags: [], anonId: 'w-' + text });
}

async function getJson(url) {
  return (await fetch(baseUrl + url)).json();
}

// 보통 가격 범위를 묻는 호출에만 범위를 주고, 다른 호출(요약 등)에는 쓸 수 없는 답을 준다
function mockRange(range) {
  return test.mock.method(llm, 'generateJson', async (prompt) =>
    prompt.includes('<종류>') ? JSON.stringify(range) : '{}'
  );
}

test('글과 가격이 다른 추천은 상세에 priceHeld로 나오고 평균에서 빠진다', async () => {
  addPlace('h1', '음식점 > 일식');
  addReview('h1', '제육 7천원인데 양 많고 혼밥하기 좋음', 99999);
  mockRange({ min: 8000, max: 13000 });

  const detail = await getJson('/api/places/h1');
  const list = await getJson('/api/places');

  assert.strictEqual(detail.reviews[0].priceHeld, true);
  assert.strictEqual(detail.reviews[0].price, 99999);
  assert.strictEqual(detail.stats.averagePrice, null);
  assert.strictEqual(list.places.find((p) => p.id === 'h1').averagePrice, null);
});

test('보류하지 않은 가격만 평균에 들어간다', async () => {
  addPlace('h2', '음식점 > 한식');
  addReview('h2', '김치찌개 8천원', 8000);
  addReview('h2', '된장찌개 9천원', 9000);
  addReview('h2', '제육 7천원', 70000);
  mockRange({ min: 7000, max: 12000 });

  const detail = await getJson('/api/places/h2');

  assert.deepStrictEqual(detail.reviews.map((r) => [r.price, r.priceHeld]).sort((a, b) => a[0] - b[0]), [
    [8000, false],
    [9000, false],
    [70000, true],
  ]);
  assert.strictEqual(detail.stats.averagePrice, 8500);
});

test('LLM이 알려 준 보통 범위를 크게 벗어난 가격은 보류하고, 범위는 저장해서 다시 묻지 않는다', async () => {
  addPlace('h3', '음식점 > 분식 > 떡볶이');
  addReview('h3', '맛있음', 90000);
  const fake = mockRange({ min: 4000, max: 9000 });

  const first = await getJson('/api/places/h3');
  const second = await getJson('/api/places/h3');
  const list = await getJson('/api/places');

  assert.strictEqual(first.reviews[0].priceHeld, true);
  assert.strictEqual(second.reviews[0].priceHeld, true);
  assert.strictEqual(list.places.find((p) => p.id === 'h3').averagePrice, null);
  assert.strictEqual(fake.mock.calls.filter((call) => call.arguments[0].includes('<종류>')).length, 1);
  assert.deepStrictEqual(
    { min: store.getPriceRange('분식 > 떡볶이').min, max: store.getPriceRange('분식 > 떡볶이').max },
    { min: 4000, max: 9000 }
  );
});

test('LLM이 실패하면 글과 다른 기록으로만 판단하고 상세는 그대로 나온다', async () => {
  addPlace('h4', '음식점 > 양식');
  addReview('h4', '파스타 맛있음', 90000);
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('Gemini 호출 실패 (500)');
  });

  const detail = await getJson('/api/places/h4');

  assert.strictEqual(detail.reviews[0].priceHeld, false);
  assert.strictEqual(detail.stats.averagePrice, 90000);
});

test('글이 가격을 뒷받침하면 LLM에게 범위를 묻지 않는다', async () => {
  addPlace('h5', '음식점 > 중식');
  addReview('h5', '짜장면 7천원', 7000);
  const fake = mockRange({ min: 6000, max: 10000 });

  await getJson('/api/places/h5');

  assert.strictEqual(fake.mock.calls.filter((call) => call.arguments[0].includes('<종류>')).length, 0);
});
