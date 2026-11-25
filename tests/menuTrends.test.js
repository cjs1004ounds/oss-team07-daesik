const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TREND_DAYS,
  MAX_TRENDS,
  BATCH_SIZE,
  buildMenuPrompt,
  parseMenus,
  recentReviews,
  reviewsToExtract,
  trendingMenus,
} = require('../shared/menuTrends');

const NOW = Date.parse('2026-11-25T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function review(id, days, extra = {}) {
  return { id: id, placeId: 'p1', text: '글 ' + id, createdAt: daysAgo(days), ...extra };
}

// 함수

test('문장에 추천마다 id가 붙고 <추천> 블록 안에 들어간다', () => {
  const prompt = buildMenuPrompt([{ id: 'r1', text: '제육 양 많음' }, { id: 'r2', text: '아아\n시원함' }]);
  assert.ok(prompt.includes('<추천>\nr1: 제육 양 많음\nr2: 아아 시원함\n</추천>'));
  assert.ok(prompt.includes('지어내지 않는다'));
});

test('id별 메뉴를 꺼내고, 보낸 id는 메뉴가 없어도 빈 목록으로 넣는다', () => {
  const result = parseMenus('{"menus":{"r1":["제육볶음"],"r9":["모르는 id"]}}', ['r1', 'r2']);
  assert.deepStrictEqual(result, { ok: true, value: { r1: ['제육볶음'], r2: [] } });
});

test('겹치는 메뉴, 너무 긴 이름, 특수문자가 섞인 이름은 빼고 3개까지만 받는다', () => {
  const result = parseMenus(
    JSON.stringify({ menus: { r1: ['제육볶음', '제육 볶음', '가'.repeat(16), '<b>국밥</b>', '김치찌개', '된장찌개', '계란말이'] } }),
    ['r1']
  );
  assert.deepStrictEqual(result.value.r1, ['제육볶음', '김치찌개', '된장찌개']);
});

test('JSON이 아니거나 목록 모양이 아니면 버린다', () => {
  assert.strictEqual(parseMenus('제육볶음', ['r1']).ok, false);
  assert.strictEqual(parseMenus('{"menus":["제육볶음"]}', ['r1']).ok, false);
  assert.strictEqual(parseMenus('', ['r1']).ok, false);
});

test(`최근 ${TREND_DAYS}일 안의 숨기지 않은 추천만 본다`, () => {
  const list = recentReviews([review('a', 1), review('b', TREND_DAYS), review('c', 2, { hidden: true }), review('d', -1)], NOW);
  assert.deepStrictEqual(list.map((r) => r.id), ['a']);
});

test(`아직 뽑지 않은 추천만 ${BATCH_SIZE}개까지 고른다`, () => {
  const many = Array.from({ length: 25 }, (_, i) => review('r' + i, 1));
  many[0].menusCheckedAt = daysAgo(0);
  const pending = reviewsToExtract(many, NOW);
  assert.strictEqual(pending.length, BATCH_SIZE);
  assert.strictEqual(pending.some((r) => r.id === 'r0'), false);
});

test('메뉴마다 나온 추천 수를 세고 많은 순으로, 띄어쓰기만 다른 이름은 같은 메뉴로 센다', () => {
  const reviews = [
    review('a', 1, { menus: ['제육볶음'], placeId: 'p1' }),
    review('b', 2, { menus: ['제육 볶음', '김치찌개'], placeId: 'p2' }),
    review('c', 3, { menus: ['김치찌개'], placeId: 'p1' }),
    review('d', 1, { menus: ['제육볶음'], placeId: 'p1' }),
  ];
  const places = [{ id: 'p1', name: '윤스쿡' }, { id: 'p2', name: '한식밥상' }];

  assert.deepStrictEqual(trendingMenus(reviews, places, NOW), [
    { name: '제육볶음', count: 3, places: [{ id: 'p1', name: '윤스쿡' }, { id: 'p2', name: '한식밥상' }] },
    { name: '김치찌개', count: 2, places: [{ id: 'p2', name: '한식밥상' }, { id: 'p1', name: '윤스쿡' }] },
  ]);
});

test('수가 같으면 최근에 나온 메뉴가 앞이다', () => {
  const reviews = [review('a', 5, { menus: ['국밥'] }), review('b', 1, { menus: ['라멘'] })];
  assert.deepStrictEqual(trendingMenus(reviews, [], NOW).map((m) => m.name), ['라멘', '국밥']);
});

test('사용자가 적은 먹은 메뉴 칸(menu)도 같이 세고, 한 추천에서 같은 메뉴는 한 번만 센다', () => {
  const reviews = [review('a', 1, { menus: ['돈까스'], menu: '돈까스' }), review('b', 1, { menu: '돈까스' })];
  assert.strictEqual(trendingMenus(reviews, [], NOW)[0].count, 2);
});

test(`${MAX_TRENDS}개까지만 돌려주고, 기록이 없으면 빈 목록이다`, () => {
  const reviews = Array.from({ length: 12 }, (_, i) => review('r' + i, 1, { menus: ['메뉴' + i] }));
  assert.strictEqual(trendingMenus(reviews, [], NOW).length, MAX_TRENDS);
  assert.deepStrictEqual(trendingMenus([], [], NOW), []);
  assert.deepStrictEqual(trendingMenus(undefined, undefined, NOW), []);
});

// API

const app = require('../server/app');
const store = require('../server/store');
const llm = require('../server/llm');

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-trends-test-'));
  process.env.DATA_DIR = path.join(dataDir, 'runtime');
  process.env.SEED_DIR = path.join(dataDir, 'seed');
  store.load();
  store.addPlace({ id: 'yoon', name: '윤스쿡', lat: 37.62, lng: 127.058, category: '음식점 > 일식' });
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
});

async function getTrends() {
  return (await fetch(`${baseUrl}/api/trends`)).json();
}

test('LLM으로 새 추천의 메뉴를 뽑아 세고, 다음에는 다시 묻지 않는다', async () => {
  const r1 = store.addReview({ placeId: 'yoon', text: '제육 7천원인데 양 많음', price: 7000, tags: [], anonId: 'a' });
  const r2 = store.addReview({ placeId: 'yoon', text: '제육덮밥 맛있음 돈까스도 괜찮음', price: null, tags: [], anonId: 'b' });
  const fake = test.mock.method(llm, 'generateJson', async () =>
    JSON.stringify({ menus: { [r1.id]: ['제육볶음'], [r2.id]: ['제육볶음', '돈까스'] } })
  );

  const first = await getTrends();
  const second = await getTrends();

  assert.strictEqual(first.days, 14);
  assert.deepStrictEqual(first.menus.map((m) => [m.name, m.count]), [['제육볶음', 2], ['돈까스', 1]]);
  assert.deepStrictEqual(first.menus[0].places, [{ id: 'yoon', name: '윤스쿡' }]);
  assert.deepStrictEqual(second.menus, first.menus);
  assert.strictEqual(fake.mock.callCount(), 1);
  assert.strictEqual(typeof store.getReview(r1.id).menusCheckedAt, 'string');
});

test('LLM이 실패하면 이미 뽑아 둔 것으로만 세고, 다음에 다시 뽑는다', async () => {
  const r3 = store.addReview({ placeId: 'yoon', text: '라멘 국물 진함', price: null, tags: [], anonId: 'c' });
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('Gemini 호출 실패 (500)');
  });
  const failed = await getTrends();

  test.mock.restoreAll();
  test.mock.method(llm, 'generateJson', async () => JSON.stringify({ menus: { [r3.id]: ['라멘'] } }));
  const later = await getTrends();

  assert.deepStrictEqual(failed.menus.map((m) => m.name), ['제육볶음', '돈까스']);
  assert.ok(later.menus.some((m) => m.name === '라멘'));
});

test('새 추천이 없으면 LLM을 부르지 않는다', async () => {
  const fake = test.mock.method(llm, 'generateJson', async () => '{"menus":{}}');
  await getTrends();
  assert.strictEqual(fake.mock.callCount(), 0);
});
