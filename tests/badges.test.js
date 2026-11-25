const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { TITLES, countRecordsByPerson, titleFor } = require('../shared/badges');

// 한국 시간 낮 12시의 기록. day는 11월의 날짜
function record(anonId, placeId, day, extra = {}) {
  return {
    anonId: anonId,
    placeId: placeId,
    verified: true,
    createdAt: `2026-11-${String(day).padStart(2, '0')}T03:00:00.000Z`,
    ...extra,
  };
}

// 기록 세기

test('교내 인증 상태에서 남긴 한 줄 추천과 다녀왔어요를 센다', () => {
  const counts = countRecordsByPerson([record('a', 'p1', 20), record('a', 'p2', 21)], [record('a', 'p3', 22)]);
  assert.deepStrictEqual(counts.get('a'), { recordCount: 3, placeCount: 3 });
});

test('인증 없이 남긴 기록과 숨겨진 글은 세지 않는다', () => {
  const reviews = [record('a', 'p1', 20, { verified: false }), record('a', 'p2', 21, { hidden: true }), record('a', 'p3', 22)];
  assert.deepStrictEqual(countRecordsByPerson(reviews, []).get('a'), { recordCount: 1, placeCount: 1 });
});

test('같은 가게에 같은 날 남긴 한 줄 추천과 다녀왔어요는 한 번으로 센다', () => {
  const counts = countRecordsByPerson([record('a', 'p1', 20)], [record('a', 'p1', 20)]);
  assert.deepStrictEqual(counts.get('a'), { recordCount: 1, placeCount: 1 });
});

test('같은 가게라도 다른 날이면 따로 세고 가게 수는 하나다', () => {
  const counts = countRecordsByPerson([record('a', 'p1', 20)], [record('a', 'p1', 21)]);
  assert.deepStrictEqual(counts.get('a'), { recordCount: 2, placeCount: 1 });
});

test('한국 시간으로 날짜를 나눈다. UTC 15시가 한국 0시다', () => {
  const late = { anonId: 'a', placeId: 'p1', verified: true, createdAt: '2026-11-20T14:59:00.000Z' };
  const next = { anonId: 'a', placeId: 'p1', verified: true, createdAt: '2026-11-20T15:01:00.000Z' };
  assert.strictEqual(countRecordsByPerson([late], [next]).get('a').recordCount, 2);
});

test('사람마다 따로 세고, 기록이 없는 사람은 들어 있지 않다', () => {
  const counts = countRecordsByPerson([record('a', 'p1', 20), record('b', 'p1', 20)], []);
  assert.strictEqual(counts.get('a').recordCount, 1);
  assert.strictEqual(counts.get('b').recordCount, 1);
  assert.strictEqual(counts.get('c'), undefined);
});

test('모양이 잘못된 기록은 건너뛴다', () => {
  const counts = countRecordsByPerson([null, { verified: true }, record('a', 'p1', 20, { createdAt: '어제' })], undefined);
  assert.strictEqual(counts.size, 0);
});

// 칭호

test('기록 수에 맞는 칭호와 다음 칭호까지 남은 수를 돌려준다', () => {
  assert.deepStrictEqual(titleFor(0), { title: null, nextTitle: '첫 숟갈', remaining: 1 });
  assert.deepStrictEqual(titleFor(1), { title: '첫 숟갈', nextTitle: '단골', remaining: 4 });
  assert.deepStrictEqual(titleFor(4), { title: '첫 숟갈', nextTitle: '단골', remaining: 1 });
  assert.deepStrictEqual(titleFor(5), { title: '단골', nextTitle: '맛잘알', remaining: 10 });
  assert.deepStrictEqual(titleFor(15), { title: '맛잘알', nextTitle: '대식가', remaining: 15 });
});

test('가장 높은 칭호면 다음 칭호가 없다', () => {
  assert.deepStrictEqual(titleFor(30), { title: '대식가', nextTitle: null, remaining: null });
  assert.deepStrictEqual(titleFor(500), { title: '대식가', nextTitle: null, remaining: null });
});

test('숫자가 아니거나 음수면 기록이 없는 것으로 본다', () => {
  assert.strictEqual(titleFor(-3).title, null);
  assert.strictEqual(titleFor('5').title, null);
  assert.strictEqual(titleFor(undefined).title, null);
});

test('칭호는 기록 수가 큰 것부터 적혀 있다', () => {
  const mins = TITLES.map((item) => item.min);
  assert.deepStrictEqual(mins, [...mins].sort((a, b) => b - a));
});

// API

const app = require('../server/app');
const store = require('../server/store');

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badges-test-'));
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

async function getJson(url) {
  const res = await fetch(baseUrl + url);
  return { status: res.status, body: await res.json() };
}

test('교내 인증한 사람이 다섯 곳에 기록하면 단골이 되고, 추천에 칭호가 붙는다', async () => {
  store.saveVerification('badge-regular', 'wifi');
  for (let i = 1; i <= 5; i += 1) {
    store.addPlace({ id: 'bp' + i, name: '칭호식당' + i, lat: 37.62, lng: 127.058, category: '음식점 > 한식' });
    store.addReview({ placeId: 'bp' + i, text: '기록 ' + i, price: null, tags: [], anonId: 'badge-regular' });
  }
  // 인증하지 않은 사람의 기록
  store.addReview({ placeId: 'bp1', text: '인증 안 한 기록', price: null, tags: [], anonId: 'badge-guest' });

  const me = await getJson('/api/me/badge-regular');
  const guest = await getJson('/api/me/badge-guest');
  const detail = await getJson('/api/places/bp1');

  assert.deepStrictEqual(me.body, { recordCount: 5, placeCount: 5, title: '단골', nextTitle: '맛잘알', remaining: 10 });
  assert.deepStrictEqual(guest.body, { recordCount: 0, placeCount: 0, title: null, nextTitle: '첫 숟갈', remaining: 1 });

  const titles = Object.fromEntries(detail.body.reviews.map((review) => [review.text, review.writerTitle]));
  assert.deepStrictEqual(titles, { '기록 1': '단골', '인증 안 한 기록': null });
  assert.strictEqual(JSON.stringify(detail.body).includes('badge-regular'), false);
});

test('기록이 없는 익명 ID도 200으로 돌려주고, 너무 긴 ID는 400이다', async () => {
  const none = await getJson('/api/me/never-wrote');
  const long = await getJson('/api/me/' + 'x'.repeat(101));

  assert.strictEqual(none.status, 200);
  assert.strictEqual(none.body.title, null);
  assert.strictEqual(long.status, 400);
});
