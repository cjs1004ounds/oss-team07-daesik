const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const store = require('../server/store');

// GET /api/places 의 도보 시간(R1), 15분 제외(R2), 필터(R3) 테스트.
// 학교 기준점(37.61924, 127.05827)에서 거리를 정해 가게를 놓는다.
// 위도 0.001도는 약 111m라서 0.009도(약 1,000m, 15분)와 0.0092도(약 1,023m, 16분)로 경계를 본다
const PLACES = [
  { id: 'near-korean', name: '가까운 국밥', lat: 37.62024, lng: 127.05827, category: '음식점 > 한식 > 국밥' },
  { id: 'near-japanese', name: '가까운 초밥', lat: 37.62124, lng: 127.05827, category: '음식점 > 일식' },
  { id: 'edge-15', name: '15분 분식', lat: 37.62824, lng: 127.05827, category: '음식점 > 분식' },
  { id: 'far-16', name: '16분 식당', lat: 37.62844, lng: 127.05827, category: '음식점 > 한식' },
];

// 가격이 무게(R14)에 흔들리지 않게 모두 같은 날 남긴 것으로 둔다
const TODAY = new Date().toISOString();

const REVIEWS = [
  { id: 'r1', placeId: 'near-korean', text: '국밥 양 많고 혼밥 좋음', price: 8000, tags: ['혼밥', '양 많음'], createdAt: TODAY },
  { id: 'r2', placeId: 'near-korean', text: '가성비 좋은 국밥집', price: 8000, tags: ['가성비'], createdAt: TODAY },
  { id: 'r3', placeId: 'near-japanese', text: '초밥 세트 괜찮음', price: 12000, tags: ['혼밥'], createdAt: TODAY },
  { id: 'r4', placeId: 'edge-15', text: '떡볶이 빨리 나옴', price: null, tags: ['빨리 나옴'], createdAt: TODAY },
  { id: 'r5', placeId: 'far-16', text: '멀지만 맛있음', price: 7000, tags: ['혼밥'], createdAt: TODAY },
];

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'places-filter-test-'));
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

async function getPlaces(query = '') {
  const res = await fetch(`${baseUrl}/api/places${query}`);
  return { status: res.status, body: await res.json() };
}

function idsOf(body) {
  return body.places.map((place) => place.id).sort();
}

test('15분 안의 가게만 돌려주고 16분인 가게는 뺀다 (R2)', async () => {
  const { status, body } = await getPlaces();

  assert.strictEqual(status, 200);
  assert.deepStrictEqual(idsOf(body), ['edge-15', 'near-japanese', 'near-korean']);
});

test('가게마다 도보 시간을 붙인다 (R1)', async () => {
  const { body } = await getPlaces();
  const minutes = Object.fromEntries(body.places.map((place) => [place.id, place.walkMinutes]));

  assert.strictEqual(minutes['near-korean'], 2);
  assert.strictEqual(minutes['edge-15'], 15);
});

test('가게마다 추천에 나온 태그를 붙인다', async () => {
  const { body } = await getPlaces();
  const korean = body.places.find((place) => place.id === 'near-korean');

  assert.deepStrictEqual(korean.tags, ['혼밥', '양 많음', '가성비']);
});

test('maxPrice를 걸면 평균 가격이 상한 이하인 가게만 남고, 가격이 없는 가게는 빠진다', async () => {
  const { body } = await getPlaces('?maxPrice=8000');

  assert.deepStrictEqual(idsOf(body), ['near-korean']);
});

test('category는 분류의 둘째 단계로 거른다', async () => {
  const { body } = await getPlaces('?category=' + encodeURIComponent('한식'));

  assert.deepStrictEqual(idsOf(body), ['near-korean']);
});

test('tags를 여러 개 걸면 모두 나온 가게만 남는다', async () => {
  const one = await getPlaces('?tags=' + encodeURIComponent('혼밥'));
  const two = await getPlaces('?tags=' + encodeURIComponent('혼밥,가성비'));

  assert.deepStrictEqual(idsOf(one.body), ['near-japanese', 'near-korean']);
  assert.deepStrictEqual(idsOf(two.body), ['near-korean']);
});

test('맞는 가게가 없으면 빈 목록을 돌려준다', async () => {
  const { status, body } = await getPlaces('?tags=' + encodeURIComponent('매움'));

  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.places, []);
});

test('maxPrice가 숫자가 아니면 400과 오류 문구를 돌려준다', async () => {
  const { status, body } = await getPlaces('?maxPrice=' + encodeURIComponent('8천'));

  assert.strictEqual(status, 400);
  assert.strictEqual(typeof body.error, 'string');
});