const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const llm = require('../server/llm');
const store = require('../server/store');
const { koreaDay } = require('../shared/usageLimit');
const { dayIndex } = require('../shared/todayPick');

// 오늘의 추천(GET /api/places/today)을 API로 확인한다.
// 비율이 있는 가게가 필요해서 임시 폴더의 파일에 직접 써 넣고 읽어 온다. LLM은 가짜로 바꾼다
let server;
let baseUrl;
let dataDir;
let runtime;

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

// 인증된 응답 3개를 만든다. again이 true인 개수로 비율을 정한다
function visits(placeId, againCount) {
  return [0, 1, 2].map((i) => ({
    id: placeId + '-v' + i,
    placeId: placeId,
    again: i < againCount,
    anonId: placeId + '-person' + i,
    verified: true,
    createdAt: hoursAgo(1),
  }));
}

function review(id, placeId, text, hours) {
  return { id: id, placeId: placeId, text: text, price: 8000, tags: [], anonId: 'writer-' + id, createdAt: hoursAgo(hours) };
}

function writeData(places, reviews, visitList) {
  fs.writeFileSync(path.join(runtime, 'places.json'), JSON.stringify(places));
  fs.writeFileSync(path.join(runtime, 'reviews.json'), JSON.stringify(reviews));
  fs.writeFileSync(path.join(runtime, 'visits.json'), JSON.stringify(visitList));
  store.load();
}

const GOOD = { id: 'today-1', name: '좋은식당', lat: 37.62, lng: 127.058, category: '음식점 > 한식' };
const ALSO_GOOD = { id: 'today-2', name: '괜찮은식당', lat: 37.62, lng: 127.058, category: '음식점 > 분식' };
const BAD = { id: 'today-3', name: '별로식당', lat: 37.62, lng: 127.058, category: '음식점 > 양식' };

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-test-'));
  runtime = path.join(dataDir, 'runtime');
  fs.mkdirSync(runtime);
  process.env.DATA_DIR = runtime;
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

async function getToday() {
  const res = await fetch(baseUrl + '/api/places/today');
  return { status: res.status, body: await res.json() };
}

test('기록이 없으면 pick이 null이다', async () => {
  writeData([], [], []);

  const { status, body } = await getToday();

  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body, { pick: null });
});

test('또 갈래요 비율이 높은 가게를 고르고 이유와 요약을 붙인다', async () => {
  writeData(
    [GOOD, BAD],
    [review('t1', 'today-1', '제육이 맛있어요', 2), review('t2', 'today-1', '양이 많아요', 1)],
    [...visits('today-1', 3), ...visits('today-3', 0)]
  );
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"summary":"제육이 맛있고 양이 많다는 추천입니다."}');

  const { body } = await getToday();

  assert.strictEqual(body.pick.id, 'today-1');
  assert.strictEqual(body.pick.name, '좋은식당');
  assert.strictEqual(body.pick.againRatio, 100);
  assert.ok(body.pick.reason.startsWith('또 갈래요 100%, 걸어서 '));
  assert.ok(body.pick.reason.endsWith('1인 약 8,000원'));
  assert.strictEqual(body.pick.summary, '제육이 맛있고 양이 많다는 추천입니다.');
  assert.strictEqual(body.pick.quote, '양이 많아요');
  assert.strictEqual(fakeLlm.mock.callCount(), 1);
  // 익명 ID 같은 값은 내보내지 않는다
  assert.deepStrictEqual(Object.keys(body.pick).sort(), [
    'againRatio',
    'averagePrice',
    'category',
    'id',
    'name',
    'quote',
    'reason',
    'reviewCount',
    'summary',
    'walkMinutes',
  ]);
});

test('LLM이 실패해도 가게는 고르고 요약만 null이다', async () => {
  writeData(
    [GOOD],
    [review('f1', 'today-1', '국물이 진해요', 2), review('f2', 'today-1', '반찬이 많아요', 1)],
    visits('today-1', 2)
  );
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('GEMINI_API_KEY가 없습니다.');
  });

  const { status, body } = await getToday();

  assert.strictEqual(status, 200);
  assert.strictEqual(body.pick.id, 'today-1');
  assert.strictEqual(body.pick.summary, null);
  assert.strictEqual(body.pick.quote, '반찬이 많아요');
});

test('비율이 50%보다 낮은 가게만 있으면 추천하지 않는다', async () => {
  writeData([BAD], [review('b1', 'today-3', '그냥 그래요', 1)], visits('today-3', 1));

  const { body } = await getToday();

  assert.deepStrictEqual(body, { pick: null });
});

test('후보가 여러 곳이면 오늘 날짜에 맞는 가게가 나온다', async () => {
  writeData([GOOD, ALSO_GOOD], [], [...visits('today-1', 3), ...visits('today-2', 2)]);

  const { body } = await getToday();

  // R5 순서는 좋은식당(100%), 괜찮은식당(67%)이다
  const expected = ['today-1', 'today-2'][dayIndex(koreaDay(Date.now()), 2)];
  assert.strictEqual(body.pick.id, expected);
  // 한 줄 추천이 없으면 요약도 인용도 없다
  assert.strictEqual(body.pick.summary, null);
  assert.strictEqual(body.pick.quote, null);
});

test('today가 가게 id로 읽히지 않는다', async () => {
  writeData([], [], []);

  const { status } = await getToday();

  assert.strictEqual(status, 200);
});
