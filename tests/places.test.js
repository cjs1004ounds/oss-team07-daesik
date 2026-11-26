const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const store = require('../server/store');

// 시드 폴더에 가게와 한 줄 추천을 미리 넣어 두고 시작한다.
// 한 줄 추천의 시각을 직접 정해야 최근 순서를 확인할 수 있어서 addReview 대신 파일로 넣는다
const PLACES = [
  { id: '1', name: '기록 두 개 식당', lat: 37.62, lng: 127.06, category: '음식점 > 한식' },
  { id: '2', name: '기록 한 개 분식', lat: 37.621, lng: 127.059, category: '음식점 > 분식' },
];

const REVIEWS = [
  {
    id: 'r-old',
    placeId: '1',
    text: '예전에 먹은 제육 양 많음',
    price: 7000,
    tags: ['양 많음'],
    anonId: 'anon-a',
    createdAt: '2026-11-01T03:00:00.000Z',
  },
  {
    id: 'r-new',
    placeId: '1',
    text: '어제 먹은 김치찌개 혼밥하기 좋음',
    price: null,
    tags: ['혼밥'],
    anonId: 'anon-b',
    createdAt: '2026-11-20T03:00:00.000Z',
  },
  {
    id: 'r-other',
    placeId: '2',
    text: '떡볶이 빨리 나옴',
    price: 5000,
    tags: ['빨리 나옴'],
    anonId: 'anon-a',
    createdAt: '2026-11-10T03:00:00.000Z',
  },
];

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'places-test-'));
  const seedDir = path.join(dataDir, 'seed');
  fs.mkdirSync(seedDir);
  fs.writeFileSync(path.join(seedDir, 'places.json'), JSON.stringify(PLACES));
  fs.writeFileSync(path.join(seedDir, 'reviews.json'), JSON.stringify(REVIEWS));

  process.env.DATA_DIR = path.join(dataDir, 'runtime');
  process.env.SEED_DIR = seedDir;
  store.load();

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('GET /api/places는 기록이 있는 가게를 전부 돌려준다', async () => {
  const res = await fetch(`${baseUrl}/api/places`);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.places.length, 2);
});

test('GET /api/places는 가게마다 한 줄 추천 수를 붙인다', async () => {
  const res = await fetch(`${baseUrl}/api/places`);
  const body = await res.json();

  const counts = Object.fromEntries(body.places.map((place) => [place.id, place.reviewCount]));
  assert.deepStrictEqual(counts, { 1: 2, 2: 1 });
});

test('GET /api/places의 가게는 정해진 값만 담는다', async () => {
  const res = await fetch(`${baseUrl}/api/places`);
  const body = await res.json();

  assert.deepStrictEqual(Object.keys(body.places[0]).sort(), [
    'againRatio',
    'averagePrice',
    'category',
    'id',
    'lastRecordAt',
    'lat',
    'live',
    'lng',
    'name',
    'responseCount',
    'reviewCount',
    'tags',
    'visitCount',
    'walkMinutes',
  ]);
});

test('GET /api/places/:id는 가게 하나와 그 가게의 한 줄 추천을 돌려준다', async () => {
  const res = await fetch(`${baseUrl}/api/places/2`);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(body.place, PLACES[1]);
  assert.deepStrictEqual(
    body.reviews.map((review) => review.id),
    ['r-other'],
  );
});

test('GET /api/places/:id의 한 줄 추천은 최근 것이 앞에 온다', async () => {
  const res = await fetch(`${baseUrl}/api/places/1`);
  const body = await res.json();

  assert.deepStrictEqual(
    body.reviews.map((review) => review.id),
    ['r-new', 'r-old'],
  );
});

test('GET /api/places/:id의 한 줄 추천에는 익명 ID가 없다', async () => {
  const res = await fetch(`${baseUrl}/api/places/1`);
  const body = await res.json();

  for (const review of body.reviews) {
    assert.strictEqual(review.anonId, undefined);
  }
});

test('GET /api/places/:id는 가격이 없는 추천의 price를 null로 둔다', async () => {
  const res = await fetch(`${baseUrl}/api/places/1`);
  const body = await res.json();

  const noPrice = body.reviews.find((review) => review.id === 'r-new');
  assert.strictEqual(noPrice.price, null);
});

test('GET /api/places/:id는 없는 가게면 404와 오류 문구를 돌려준다', async () => {
  const res = await fetch(`${baseUrl}/api/places/999`);
  const body = await res.json();

  assert.strictEqual(res.status, 404);
  assert.strictEqual(typeof body.error, 'string');
});