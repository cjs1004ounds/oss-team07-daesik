const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const llm = require('../server/llm');
const store = require('../server/store');
const { MAX_PLACE_MENUS, placeMenus } = require('../shared/menuTrends');

// 가게 하나에서 많이 먹은 메뉴 (가게 상세의 topMenus)

function review(id, hoursAgo, extra = {}) {
  return {
    id: id,
    placeId: 'm1',
    text: '글 ' + id,
    createdAt: new Date(Date.parse('2026-11-25T03:00:00.000Z') - hoursAgo * 60 * 60 * 1000).toISOString(),
    ...extra,
  };
}

test('메뉴마다 나온 추천 수를 세고 많은 순으로 돌려준다', () => {
  const menus = placeMenus([
    review('a', 3, { menu: '제육볶음' }),
    review('b', 2, { menus: ['제육 볶음', '돈까스'] }),
    review('c', 1, { menu: '돈까스', menus: ['제육볶음'] }),
    review('d', 0, { menu: '우동' }),
  ]);
  assert.deepStrictEqual(menus, [
    { name: '제육볶음', count: 3 },
    { name: '돈까스', count: 2 },
    { name: '우동', count: 1 },
  ]);
});

test('오래된 추천도 세고, 숨긴 글은 세지 않는다', () => {
  const menus = placeMenus([
    review('a', 24 * 200, { menu: '국밥' }),
    review('b', 1, { menu: '국밥', hidden: true }),
    review('c', 0, { menu: '수육', hidden: true }),
  ]);
  assert.deepStrictEqual(menus, [{ name: '국밥', count: 1 }]);
});

test('한 추천에서 같은 메뉴는 한 번만 센다', () => {
  const menus = placeMenus([review('a', 0, { menu: '제육볶음', menus: ['제육볶음', '제육 볶음'] })]);
  assert.deepStrictEqual(menus, [{ name: '제육볶음', count: 1 }]);
});

test(`${MAX_PLACE_MENUS}개까지만 돌려주고, 메뉴가 없으면 빈 목록이다`, () => {
  const many = Array.from({ length: MAX_PLACE_MENUS + 3 }, (_, i) => review('r' + i, i, { menu: '메뉴' + i }));
  assert.strictEqual(placeMenus(many).length, MAX_PLACE_MENUS);
  assert.deepStrictEqual(placeMenus([review('a', 0)]), []);
  assert.deepStrictEqual(placeMenus(null), []);
});

// API

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-menus-test-'));
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
});

test('가게 상세에 그 가게의 메뉴만 topMenus로 붙는다', async () => {
  // 요약과 가격 범위를 만들려는 LLM 호출은 실패하게 둔다. 메뉴는 LLM 없이 센다
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('GEMINI_API_KEY가 없습니다.');
  });
  store.addPlace({ id: 'menu-1', name: '메뉴식당', lat: 37.62, lng: 127.058, category: '음식점 > 한식' });
  store.addPlace({ id: 'menu-2', name: '다른식당', lat: 37.62, lng: 127.058, category: '음식점 > 한식' });
  store.addReview({ placeId: 'menu-1', text: '제육이 맛있어요', price: null, tags: [], menu: '제육볶음', anonId: 'a' });
  store.addReview({ placeId: 'menu-1', text: '또 제육 먹었어요', price: null, tags: [], menu: '제육볶음', anonId: 'b' });
  store.addReview({ placeId: 'menu-1', text: '돈까스도 괜찮아요', price: null, tags: [], menu: '돈까스', anonId: 'c' });
  store.addReview({ placeId: 'menu-2', text: '여기는 국밥이에요', price: null, tags: [], menu: '국밥', anonId: 'a' });

  const body = await (await fetch(baseUrl + '/api/places/menu-1')).json();
  const other = await (await fetch(baseUrl + '/api/places/menu-2')).json();

  assert.deepStrictEqual(body.topMenus, [
    { name: '제육볶음', count: 2 },
    { name: '돈까스', count: 1 },
  ]);
  assert.deepStrictEqual(other.topMenus, [{ name: '국밥', count: 1 }]);
});

test('메뉴가 적힌 추천이 없으면 topMenus는 빈 목록이다', async () => {
  store.addPlace({ id: 'menu-3', name: '메뉴없는식당', lat: 37.62, lng: 127.058, category: '음식점 > 한식' });
  store.addReview({ placeId: 'menu-3', text: '그냥 맛있어요', price: null, tags: [], anonId: 'a' });

  const body = await (await fetch(baseUrl + '/api/places/menu-3')).json();

  assert.deepStrictEqual(body.topMenus, []);
});
