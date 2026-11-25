const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const store = require('../server/store');

// GET /api/places 의 정렬(R5) 테스트.
// 비율은 교내 인증된 "다녀왔어요" 응답이 3개 이상일 때만 나온다(R4, R14).
// 무게(R14)에 흔들리지 않게 모든 응답을 같은 시각에 남긴 것으로 둔다
const NOW = new Date().toISOString();

// 학교 기준점(37.61924, 127.05827)에서 북쪽으로. 위도 0.001도는 약 111m
const PLACES = [
  { id: 'ratio-67-far', name: '비율 67 먼 곳', lat: 37.62524, lng: 127.05827, category: '음식점 > 한식' },
  { id: 'ratio-67-near', name: '비율 67 가까운 곳', lat: 37.62024, lng: 127.05827, category: '음식점 > 한식' },
  { id: 'ratio-100', name: '비율 100', lat: 37.62724, lng: 127.05827, category: '음식점 > 일식' },
  { id: 'ratio-0', name: '비율 0', lat: 37.62124, lng: 127.05827, category: '음식점 > 한식' },
  { id: 'too-few', name: '기록 부족', lat: 37.61974, lng: 127.05827, category: '음식점 > 한식' },
];

// 가게 하나에 응답 여러 개. again 배열의 true/false 개수가 비율이 된다
function visitsFor(placeId, agains) {
  return agains.map((again, i) => ({
    id: `${placeId}-v${i}`,
    placeId,
    again,
    anonId: `anon-${placeId}-${i}`,
    verified: true,
    createdAt: NOW,
  }));
}

const VISITS = [
  ...visitsFor('ratio-67-far', [true, true, false]),
  ...visitsFor('ratio-67-near', [true, true, false]),
  ...visitsFor('ratio-100', [true, true, true]),
  ...visitsFor('ratio-0', [false, false, false]),
  // 응답이 2개뿐이라 "기록 부족"
  ...visitsFor('too-few', [true, true]),
];

const REVIEWS = [
  { id: 'r1', placeId: 'ratio-67-far', text: '멀지만 괜찮은 집', price: 7000, tags: ['혼밥'], createdAt: NOW },
  { id: 'r2', placeId: 'ratio-67-near', text: '가깝고 괜찮은 집', price: 7000, tags: ['혼밥'], createdAt: NOW },
  { id: 'r3', placeId: 'ratio-100', text: '다들 또 간다는 집', price: 12000, tags: [], createdAt: NOW },
  { id: 'r4', placeId: 'ratio-0', text: '다시는 안 간다는 집', price: 6000, tags: ['혼밥'], createdAt: NOW },
  { id: 'r5', placeId: 'too-few', text: '아직 기록이 적은 집', price: 5000, tags: ['혼밥'], createdAt: NOW },
];

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'places-sort-test-'));
  const seedDir = path.join(dataDir, 'seed');
  fs.mkdirSync(seedDir);
  fs.writeFileSync(path.join(seedDir, 'places.json'), JSON.stringify(PLACES));
  fs.writeFileSync(path.join(seedDir, 'reviews.json'), JSON.stringify(REVIEWS));
  fs.writeFileSync(path.join(seedDir, 'visits.json'), JSON.stringify(VISITS));

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

async function getIds(query = '') {
  const res = await fetch(`${baseUrl}/api/places${query}`);
  const body = await res.json();
  return body.places.map((place) => place.id);
}

test('비율 높은 순, 같으면 가까운 순, 기록 부족은 맨 뒤로 정렬한다 (R5)', async () => {
  assert.deepStrictEqual(await getIds(), ['ratio-100', 'ratio-67-near', 'ratio-67-far', 'ratio-0', 'too-few']);
});

test('기록 부족인 가게는 더 가까워도 비율 0% 가게보다 뒤에 온다', async () => {
  const ids = await getIds();
  assert.ok(ids.indexOf('ratio-0') < ids.indexOf('too-few'));
});

test('필터를 걸어도 남은 가게끼리 같은 순서로 정렬한다', async () => {
  assert.deepStrictEqual(await getIds('?tags=' + encodeURIComponent('혼밥')), [
    'ratio-67-near',
    'ratio-67-far',
    'ratio-0',
    'too-few',
  ]);
});