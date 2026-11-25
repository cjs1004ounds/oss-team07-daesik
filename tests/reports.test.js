const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const store = require('../server/store');
const llm = require('../server/llm');

// 실제 Gemini는 부르지 않는다. llm.generateJson을 가짜 함수로 바꿔서 판단 결과를 정해 둔다
let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-test-'));
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

let placeNumber = 0;

// 가게 하나와 한 줄 추천 하나를 만들고 추천 id를 돌려준다
function makeReview(text) {
  placeNumber += 1;
  const placeId = 'place-' + placeNumber;
  store.addPlace({ id: placeId, name: '신고테스트식당' + placeNumber, lat: 37.62, lng: 127.058, category: '음식점 > 한식' });
  const review = store.addReview({ placeId: placeId, text: text, price: null, tags: [], anonId: 'writer' });
  return { placeId: placeId, reviewId: review.id };
}

function verifyPeople(names) {
  for (const name of names) {
    store.saveVerification(name, 'wifi');
  }
}

async function report(reviewId, anonId) {
  const res = await fetch(`${baseUrl}/api/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewId: reviewId, anonId: anonId }),
  });
  return { status: res.status, body: await res.json() };
}

async function detailTexts(placeId) {
  const body = await (await fetch(`${baseUrl}/api/places/${placeId}`)).json();
  return body.reviews.map((review) => review.text);
}

function llmAnswers(json) {
  return test.mock.method(llm, 'generateJson', async () => JSON.stringify(json));
}

test('신고하면 201이고, LLM이 정상이라고 하면 숨기지 않는다', async () => {
  const fake = llmAnswers({ verdict: 'ok', reason: '솔직한 후기' });
  const { placeId, reviewId } = makeReview('양은 많은데 좀 짰어요');

  const res = await report(reviewId, 'reporter-1');

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.hidden, false);
  assert.strictEqual(res.body.report.reviewId, reviewId);
  assert.strictEqual(res.body.report.anonId, undefined);
  assert.strictEqual(fake.mock.callCount(), 1);
  assert.deepStrictEqual(await detailTexts(placeId), ['양은 많은데 좀 짰어요']);
});

test('LLM이 악의적이라고 하면 신고 1건으로 숨기고 상세와 추천 수에서 빠진다', async () => {
  llmAnswers({ verdict: 'malicious', reason: '전화번호가 있음' });
  const { placeId, reviewId } = makeReview('사장님 번호 010-0000-0000 연락주세요');

  const res = await report(reviewId, 'reporter-1');

  assert.strictEqual(res.body.hidden, true);
  assert.deepStrictEqual(await detailTexts(placeId), []);
  const list = await (await fetch(`${baseUrl}/api/places`)).json();
  assert.strictEqual(list.places.find((place) => place.id === placeId).reviewCount, 0);

  const saved = store.getReview(reviewId);
  assert.strictEqual(saved.hiddenReason, 'llm');
  assert.strictEqual(saved.moderation.verdict, 'malicious');
});

test('LLM은 글마다 한 번만 부르고 다음 신고부터는 저장해 둔 판단을 쓴다', async () => {
  const fake = llmAnswers({ verdict: 'unsure', reason: '' });
  const { reviewId } = makeReview('그냥 그랬음');

  await report(reviewId, 'reporter-1');
  await report(reviewId, 'reporter-2');

  assert.strictEqual(fake.mock.callCount(), 1);
});

test('교내 인증한 3명이 신고하면 LLM 판단 없이도 숨긴다', async () => {
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('GEMINI_API_KEY가 없습니다.');
  });
  verifyPeople(['v-1', 'v-2', 'v-3']);
  const { placeId, reviewId } = makeReview('신고가 여러 번 들어올 글');

  assert.strictEqual((await report(reviewId, 'v-1')).body.hidden, false);
  assert.strictEqual((await report(reviewId, 'v-2')).body.hidden, false);
  assert.strictEqual((await report(reviewId, 'v-3')).body.hidden, true);
  assert.strictEqual(store.getReview(reviewId).hiddenReason, 'reports');
  assert.deepStrictEqual(await detailTexts(placeId), []);
});

test('인증하지 않은 사람의 신고는 3건이 넘어도 신고 수로는 숨기지 않는다', async () => {
  llmAnswers({ verdict: 'ok', reason: '' });
  const { reviewId } = makeReview('인증 안 한 사람들이 신고할 글');

  for (const name of ['u-1', 'u-2', 'u-3', 'u-4']) {
    assert.strictEqual((await report(reviewId, name)).body.hidden, false);
  }
});

test('LLM 호출이 실패해도 신고는 저장되고 서버는 계속 돈다', async () => {
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('Gemini 호출 실패 (500)');
  });
  const { reviewId } = makeReview('LLM이 실패할 때 신고할 글');

  const res = await report(reviewId, 'reporter-1');
  const health = await fetch(`${baseUrl}/api/health`);

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.hidden, false);
  assert.strictEqual(store.getReportsByReview(reviewId).length, 1);
  assert.strictEqual(store.getReview(reviewId).moderation, undefined);
  assert.strictEqual(health.status, 200);
});

test('LLM이 이상한 답을 주면 판단으로 쓰지 않는다', async () => {
  llmAnswers({ verdict: '숨겨', reason: '' });
  const { reviewId } = makeReview('LLM이 이상하게 답할 글');

  const res = await report(reviewId, 'reporter-1');
  assert.strictEqual(res.body.hidden, false);
  assert.strictEqual(store.getReview(reviewId).moderation, undefined);
});

test('같은 사람이 같은 글을 두 번 신고하면 409다', async () => {
  llmAnswers({ verdict: 'ok', reason: '' });
  const { reviewId } = makeReview('두 번 신고할 글');

  await report(reviewId, 'reporter-1');
  const again = await report(reviewId, 'reporter-1');

  assert.strictEqual(again.status, 409);
  assert.strictEqual(store.getReportsByReview(reviewId).length, 1);
});

test('이미 숨겨진 글은 409, 없는 글은 404, 값이 빠지면 400이다', async () => {
  llmAnswers({ verdict: 'malicious', reason: '욕설' });
  const { reviewId } = makeReview('숨겨질 글');
  await report(reviewId, 'reporter-1');

  assert.strictEqual((await report(reviewId, 'reporter-2')).status, 409);
  assert.strictEqual((await report('없는-글', 'reporter-1')).status, 404);
  assert.strictEqual((await report('', 'reporter-1')).status, 400);
  assert.strictEqual((await report(reviewId, '')).status, 400);
});

test('신고 기록에는 신고할 때의 교내 인증 상태가 남는다', async () => {
  llmAnswers({ verdict: 'ok', reason: '' });
  verifyPeople(['checked-person']);
  const { reviewId } = makeReview('인증 상태를 볼 글');

  await report(reviewId, 'checked-person');
  await report(reviewId, 'unchecked-person');

  const saved = store.getReportsByReview(reviewId).map((r) => [r.anonId, r.verified]);
  assert.deepStrictEqual(saved, [['checked-person', true], ['unchecked-person', false]]);
});
