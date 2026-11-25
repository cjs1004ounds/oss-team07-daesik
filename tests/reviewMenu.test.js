const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MAX_MENU_LENGTH, validateMenu } = require('../shared/reviewValidator');
const { reviewMatches } = require('../shared/recordSearch');

// 먹은 메뉴 검사 (R6)

test('먹은 메뉴를 비워 두면 null이다', () => {
  assert.deepStrictEqual(validateMenu(undefined), { ok: true, value: null });
  assert.deepStrictEqual(validateMenu(null), { ok: true, value: null });
  assert.deepStrictEqual(validateMenu(''), { ok: true, value: null });
  assert.deepStrictEqual(validateMenu('   '), { ok: true, value: null });
});

test('적은 메뉴는 앞뒤 공백을 떼고 가운데 공백은 하나로 줄인다', () => {
  assert.deepStrictEqual(validateMenu('  제육   볶음 '), { ok: true, value: '제육 볶음' });
});

test(`${MAX_MENU_LENGTH}자까지는 되고 넘으면 안 된다`, () => {
  assert.strictEqual(validateMenu('가'.repeat(MAX_MENU_LENGTH)).ok, true);
  const tooLong = validateMenu('가'.repeat(MAX_MENU_LENGTH + 1));
  assert.strictEqual(tooLong.ok, false);
  assert.match(tooLong.error, /20자/);
});

test('글자가 아니면 안 된다', () => {
  assert.strictEqual(validateMenu(7000).ok, false);
  assert.strictEqual(validateMenu(['제육']).ok, false);
});

// 기록으로 찾기

test('LLM이 글에서 뽑아 둔 메뉴(menus)로도 찾는다', () => {
  const review = { placeId: '1', text: '제육 7천원인데 양 많음', menus: ['제육볶음'] };
  assert.strictEqual(reviewMatches(review, '제육볶음'), true);
  assert.strictEqual(reviewMatches(review, '볶음'), true);
  assert.strictEqual(reviewMatches(review, '돈까스'), false);
});

test('menus가 배열이 아니어도 오류 없이 글과 먹은 메뉴만 본다', () => {
  assert.strictEqual(reviewMatches({ placeId: '1', text: '맛있음', menus: '제육볶음' }, '제육볶음'), false);
  assert.strictEqual(reviewMatches({ placeId: '1', text: '맛있음', menu: '제육볶음' }, '제육볶음'), true);
});

// API

const app = require('../server/app');
const store = require('../server/store');
const kakao = require('../server/kakao');
const llm = require('../server/llm');

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-menu-test-'));
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

function place(id) {
  return { id: id, name: '메뉴식당' + id, lat: 37.6195, lng: 127.059, category: '음식점 > 한식' };
}

async function saveReview(body) {
  const res = await fetch(`${baseUrl}/api/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('먹은 메뉴를 적어 저장하면 추천에 남고 가게 상세에 나온다', async () => {
  const saved = await saveReview({ place: place('m1'), text: '양 많고 혼밥하기 좋음', menu: ' 제육볶음 ', anonId: 'menu-a' });
  const detail = await (await fetch(`${baseUrl}/api/places/m1`)).json();

  assert.strictEqual(saved.status, 201);
  assert.strictEqual(saved.body.review.menu, '제육볶음');
  assert.strictEqual(detail.reviews[0].menu, '제육볶음');
  assert.deepStrictEqual(detail.reviews[0].menus, []);
});

test('먹은 메뉴 없이 저장해도 되고, 그때는 menu가 null이다', async () => {
  const saved = await saveReview({ place: place('m2'), text: '그냥 무난했음요', anonId: 'menu-a' });
  assert.strictEqual(saved.status, 201);
  assert.strictEqual(saved.body.review.menu, null);
});

test('먹은 메뉴가 20자를 넘으면 400이고 저장하지 않는다', async () => {
  const saved = await saveReview({ place: place('m3'), text: '메뉴 이름이 너무 김', menu: '가'.repeat(21), anonId: 'menu-a' });
  assert.strictEqual(saved.status, 400);
  assert.strictEqual(store.getPlace('m3'), null);
});

test('먹은 메뉴로 검색하면 그 가게가 기록으로 찾은 가게로 나온다', async () => {
  await saveReview({ place: place('m4'), text: '국물이 진하고 든든함', menu: '순대국밥', anonId: 'menu-a' });
  test.mock.method(kakao, 'searchPlaces', async () => []);
  test.mock.method(llm, 'generateJson', async () => '{"keywords":[]}');

  const body = await (await fetch(`${baseUrl}/api/places/search?q=${encodeURIComponent('순대국밥')}`)).json();

  assert.deepStrictEqual(body.places.map((p) => [p.id, p.fromRecords]), [['m4', true]]);
});
