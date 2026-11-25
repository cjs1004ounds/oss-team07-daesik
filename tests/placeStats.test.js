const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const store = require('../server/store');

// 가게 목록과 상세에 붙는 비율, 가격, 마지막 기록(R14)을 API로 확인한다.
// 오래된 기록이 필요해서 임시 폴더의 파일에 직접 써 넣고 다시 읽어 온다
let server;
let baseUrl;
let dataDir;

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

const PLACE = { id: 'stat-1', name: '가중치식당', lat: 37.62, lng: 127.058, category: '음식점 > 한식' };
const EMPTY_PLACE = { id: 'stat-2', name: '기록적은식당', lat: 37.62, lng: 127.058, category: '음식점 > 분식' };

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-stats-test-'));
  const runtime = path.join(dataDir, 'runtime');
  fs.mkdirSync(runtime);
  process.env.DATA_DIR = runtime;
  process.env.SEED_DIR = path.join(dataDir, 'seed');

  const write = (name, list) => fs.writeFileSync(path.join(runtime, name), JSON.stringify(list));
  write('places.json', [PLACE, EMPTY_PLACE]);
  write('reviews.json', [
    { id: 'r1', placeId: 'stat-1', text: '최근 기록', price: 9000, tags: [], anonId: 'a', createdAt: daysAgo(0) },
    { id: 'r2', placeId: 'stat-1', text: '90일 전 기록', price: 6000, tags: [], anonId: 'b', createdAt: daysAgo(90) },
    { id: 'r3', placeId: 'stat-1', text: '숨긴 기록', price: 50000, tags: [], anonId: 'c', createdAt: daysAgo(0), hidden: true },
    { id: 'r4', placeId: 'stat-2', text: '가격 없는 기록', price: null, tags: [], anonId: 'a', createdAt: daysAgo(3) },
  ]);
  write('visits.json', [
    { id: 'v1', placeId: 'stat-1', again: true, anonId: 'a', verified: true, createdAt: daysAgo(1) },
    { id: 'v2', placeId: 'stat-1', again: true, anonId: 'b', verified: true, createdAt: daysAgo(2) },
    { id: 'v3', placeId: 'stat-1', again: false, anonId: 'c', verified: true, createdAt: daysAgo(200) },
    { id: 'v4', placeId: 'stat-1', again: false, anonId: 'd', verified: true, createdAt: daysAgo(210) },
    { id: 'v5', placeId: 'stat-1', again: false, anonId: 'e', verified: false, createdAt: daysAgo(0) },
    { id: 'v6', placeId: 'stat-1', again: false, anonId: 'f', verified: true, createdAt: daysAgo(500) },
    { id: 'v7', placeId: 'stat-2', again: true, anonId: 'a', verified: true, createdAt: daysAgo(1) },
  ]);
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

async function getJson(url) {
  const res = await fetch(baseUrl + url);
  return { status: res.status, body: await res.json() };
}

test('가게 상세에 비율, 가격, 마지막 기록이 stats로 붙는다', async () => {
  const { status, body } = await getJson('/api/places/stat-1');

  assert.strictEqual(status, 200);
  // 인증된 365일 안의 응답 4개. 또 갈래요 2개는 최근, 글쎄요 2개는 200일 전이라 비율이 50%보다 높다
  assert.strictEqual(body.stats.responseCount, 4);
  assert.ok(body.stats.againRatio > 50, `비율 ${body.stats.againRatio}`);
  // 9,000원(오늘)과 6,000원(90일 전)의 가중 평균. 숨긴 50,000원은 빠진다
  assert.strictEqual(body.stats.averagePrice, 8000);
  // 마지막 기록은 숨기지 않은 한 줄 추천과 응답 중 가장 최근 것이라 오늘 남긴 한 줄 추천보다 앞서지 않는다
  assert.ok(new Date(body.stats.lastRecordAt) >= new Date(body.reviews[0].createdAt));
});

test('가게 목록의 가게마다 같은 값이 붙는다', async () => {
  const { body } = await getJson('/api/places');
  const place = body.places.find((item) => item.id === 'stat-1');

  assert.strictEqual(place.reviewCount, 2);
  assert.strictEqual(place.responseCount, 4);
  assert.strictEqual(place.averagePrice, 8000);
  assert.strictEqual(typeof place.againRatio, 'number');
});

test('응답이 3개보다 적으면 비율은 null이고, 가격이 없으면 가격도 null이다', async () => {
  const { body } = await getJson('/api/places/stat-2');

  assert.deepStrictEqual(
    { responseCount: body.stats.responseCount, againRatio: body.stats.againRatio, averagePrice: body.stats.averagePrice },
    { responseCount: 1, againRatio: null, averagePrice: null }
  );
  // 마지막 기록은 한 줄 추천(3일 전)과 응답(1일 전) 중 최근 것
  assert.ok(new Date(body.stats.lastRecordAt) > new Date(daysAgo(2)));
});
