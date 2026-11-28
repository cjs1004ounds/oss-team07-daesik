const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MAX_REVIEWS_IN_PROMPT,
  MAX_SUMMARY_LENGTH,
  reviewsForSummary,
  needsSummary,
  summaryKey,
  buildSummaryPrompt,
  parseSummary,
} = require('../shared/placeSummary');

function review(id, text, days, extra = {}) {
  return { id: id, text: text, createdAt: new Date(Date.UTC(2026, 10, 25 - days)).toISOString(), ...extra };
}

// 함수

test('숨긴 글은 빼고 최근 것부터 고른다', () => {
  const list = reviewsForSummary([review('a', '예전 글', 5), review('b', '숨긴 글', 0, { hidden: true }), review('c', '최근 글', 1)]);
  assert.deepStrictEqual(list.map((r) => r.id), ['c', 'a']);
});

test(`추천은 ${MAX_REVIEWS_IN_PROMPT}개까지만 쓴다`, () => {
  const many = Array.from({ length: 25 }, (_, i) => review('r' + i, '글' + i, i));
  assert.strictEqual(reviewsForSummary(many).length, MAX_REVIEWS_IN_PROMPT);
});

test('보이는 추천이 2개 이상이어야 요약한다', () => {
  assert.strictEqual(needsSummary([review('a', '글', 0)]), false);
  assert.strictEqual(needsSummary([review('a', '글', 0), review('b', '숨김', 0, { hidden: true })]), false);
  assert.strictEqual(needsSummary([review('a', '글', 0), review('b', '글', 1)]), true);
  assert.strictEqual(needsSummary(undefined), false);
});

test('추천이 새로 생기거나 숨겨지면 요약 표시가 달라진다', () => {
  const two = [review('a', '글', 1), review('b', '글', 2)];
  const three = [...two, review('c', '새 글', 0)];
  const hidden = [review('a', '글', 1, { hidden: true }), review('b', '글', 2)];
  assert.notStrictEqual(summaryKey(two), summaryKey(three));
  assert.notStrictEqual(summaryKey(two), summaryKey(hidden));
  assert.strictEqual(summaryKey(two), summaryKey([...two].reverse()));
});

test('문장에 가게 이름, 추천, 가격과 태그가 <추천> 블록 안에 들어간다', () => {
  const prompt = buildSummaryPrompt('윤스쿡', [review('a', '제육 양 많음', 0, { price: 7000, tags: ['양 많음'] }), review('b', '돈까스 바삭', 1)]);
  assert.ok(prompt.includes('가게 이름: 윤스쿡'));
  assert.ok(prompt.includes('<추천>\n- 제육 양 많음 (1인 7000원, 태그 양 많음)\n- 돈까스 바삭\n</추천>'));
  assert.ok(prompt.includes('지어내지 않는다'));
});

test('JSON의 요약을 꺼내고 줄바꿈은 띄어쓰기로 바꾼다', () => {
  assert.deepStrictEqual(parseSummary('{"summary":"양이 많고\\n혼밥하기 좋다는 기록이 많아요"}'), {
    ok: true,
    value: '양이 많고 혼밥하기 좋다는 기록이 많아요',
  });
});

test(`요약이 ${MAX_SUMMARY_LENGTH}자를 넘으면 자른다`, () => {
  const result = parseSummary(JSON.stringify({ summary: '가'.repeat(120) }));
  assert.strictEqual(result.value.length, MAX_SUMMARY_LENGTH);
});

test('JSON이 아니거나 요약이 없거나 비어 있으면 버린다', () => {
  assert.strictEqual(parseSummary('양이 많아요').ok, false);
  assert.strictEqual(parseSummary('{"text":"양이 많아요"}').ok, false);
  assert.strictEqual(parseSummary('{"summary":"   "}').ok, false);
  assert.strictEqual(parseSummary(undefined).ok, false);
});

// API

const app = require('../server/app');
const store = require('../server/store');
const llm = require('../server/llm');

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-summary-test-'));
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

function addPlaceWithReviews(id, texts) {
  store.addPlace({ id: id, name: '요약식당' + id, lat: 37.62, lng: 127.058, category: '음식점 > 한식' });
  for (const text of texts) {
    store.addReview({ placeId: id, text: text, price: null, tags: [], anonId: 'writer-' + text });
  }
}

async function detail(id) {
  return (await fetch(`${baseUrl}/api/places/${id}`)).json();
}

test('추천이 2개 이상이면 상세에 요약이 붙고, 추천이 그대로면 LLM을 다시 부르지 않는다', async () => {
  addPlaceWithReviews('s1', ['제육 양 많음', '혼밥하기 좋음']);
  const fake = test.mock.method(llm, 'generateJson', async () => '{"summary":"양이 많고 혼밥하기 좋아요"}');

  const first = await detail('s1');
  const second = await detail('s1');

  assert.strictEqual(first.summary, '양이 많고 혼밥하기 좋아요');
  assert.strictEqual(second.summary, '양이 많고 혼밥하기 좋아요');
  assert.strictEqual(fake.mock.callCount(), 1);
});

test('추천이 새로 생기면 요약을 다시 만든다', async () => {
  addPlaceWithReviews('s2', ['국밥 든든', '깍두기 맛있음']);
  let answer = '{"summary":"국밥이 든든해요"}';
  const fake = test.mock.method(llm, 'generateJson', async () => answer);

  await detail('s2');
  store.addReview({ placeId: 's2', text: '요즘 가격 올랐음', price: 10000, tags: [], anonId: 'new-writer' });
  answer = '{"summary":"국밥이 든든한데 가격이 올랐다는 말도 있어요"}';
  const after = await detail('s2');

  // 가격이 있는 추천이 생기면 보통 가격 범위(R17)도 한 번 묻는다. 여기서는 요약을 만든 호출만 센다
  const summaryCalls = fake.mock.calls.filter((call) => call.arguments[0].includes('<추천>'));
  assert.strictEqual(summaryCalls.length, 2);
  assert.strictEqual(after.summary, '국밥이 든든한데 가격이 올랐다는 말도 있어요');
});

test('추천이 하나뿐이면 요약은 null이고 LLM을 부르지 않는다', async () => {
  addPlaceWithReviews('s3', ['혼자 남긴 글']);
  const fake = test.mock.method(llm, 'generateJson', async () => '{"summary":"무엇"}');

  const body = await detail('s3');

  assert.strictEqual(body.summary, null);
  assert.strictEqual(fake.mock.callCount(), 0);
});

test('LLM이 실패하거나 이상한 답을 주면 요약은 null이고 상세는 그대로 나온다', async () => {
  addPlaceWithReviews('s4', ['글 하나', '글 둘']);
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('Gemini 호출 실패 (500)');
  });
  const failed = await detail('s4');

  test.mock.restoreAll();
  test.mock.method(llm, 'generateJson', async () => '요약입니다');
  const odd = await detail('s4');

  assert.strictEqual(failed.summary, null);
  assert.strictEqual(failed.reviews.length, 2);
  assert.strictEqual(odd.summary, null);
});

test('요약을 만드는 중에 같은 가게 상세가 또 열려도 LLM은 한 번만 부른다', async () => {
  addPlaceWithReviews('s5', ['동시에 하나', '동시에 둘']);
  const fake = test.mock.method(llm, 'generateJson', async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return '{"summary":"동시에 열어도 한 번"}';
  });

  const [a, b] = await Promise.all([detail('s5'), detail('s5')]);

  assert.strictEqual(fake.mock.callCount(), 1);
  assert.strictEqual(a.summary, '동시에 열어도 한 번');
  assert.strictEqual(b.summary, '동시에 열어도 한 번');
});

// 좋은 점과 아쉬운 점

const { MAX_POINTS, MAX_POINT_LENGTH, parseSummaryPoints } = require('../shared/placeSummary');

test('문장에 좋은 점과 아쉬운 점을 나눠 달라는 규칙과 모양이 들어간다', () => {
  const prompt = buildSummaryPrompt('화로상회', [review('a', '비싸졌지만 고기는 괜찮음', 0), review('b', '숯불이라 좋음', 1)]);
  assert.ok(prompt.includes('- good: 추천에 적힌 좋은 점'));
  assert.ok(prompt.includes('- bad: 추천에 적힌 아쉬운 점'));
  assert.ok(prompt.includes('"good": ["좋은 점"], "bad": ["아쉬운 점"]'));
});

test('JSON에서 좋은 점과 아쉬운 점을 꺼낸다', () => {
  const raw = '{"summary":"고기는 괜찮은데 비싸졌다는 말이 있어요","good":["고기 질", " 숯불  향 "],"bad":["가격이 오름"]}';
  assert.deepStrictEqual(parseSummaryPoints(raw), { good: ['고기 질', '숯불 향'], bad: ['가격이 오름'] });
});

test(`좋은 점과 아쉬운 점은 각각 ${MAX_POINTS}개까지만 받는다`, () => {
  const raw = JSON.stringify({ summary: '요약', good: ['가', '나', '다', '라'], bad: ['마', '바', '사', '아'] });
  const points = parseSummaryPoints(raw);
  assert.strictEqual(points.good.length, MAX_POINTS);
  assert.strictEqual(points.bad.length, MAX_POINTS);
});

test('글자가 아닌 것, 빈 것, 너무 긴 것, 겹치는 것은 뺀다', () => {
  const raw = JSON.stringify({ summary: '요약', good: [1, '', '양이 많음', '양이  많음', '가'.repeat(MAX_POINT_LENGTH + 1)], bad: [null, '웨이팅'] });
  assert.deepStrictEqual(parseSummaryPoints(raw), { good: ['양이 많음'], bad: ['웨이팅'] });
});

test('양쪽에 같은 말이 있으면 좋은 점에만 남긴다', () => {
  const raw = '{"summary":"요약","good":["가격"],"bad":["가격","웨이팅"]}';
  assert.deepStrictEqual(parseSummaryPoints(raw), { good: ['가격'], bad: ['웨이팅'] });
});

test('목록이 없거나 JSON이 아니면 빈 목록이다', () => {
  assert.deepStrictEqual(parseSummaryPoints('{"summary":"요약만"}'), { good: [], bad: [] });
  assert.deepStrictEqual(parseSummaryPoints('{"summary":"요약","good":"양이 많음"}'), { good: [], bad: [] });
  assert.deepStrictEqual(parseSummaryPoints('요약입니다'), { good: [], bad: [] });
  assert.deepStrictEqual(parseSummaryPoints(null), { good: [], bad: [] });
});

test('상세에 좋은 점과 아쉬운 점이 summaryPoints로 붙고, 다시 열어도 그대로다', async () => {
  addPlaceWithReviews('p1', ['고기는 괜찮은데 비싸짐', '숯불이라 좋음']);
  const fake = test.mock.method(llm, 'generateJson', async () => '{"summary":"고기는 괜찮은데 비싸졌어요","good":["고기 질","숯불"],"bad":["가격이 오름"]}');

  const first = await detail('p1');
  const second = await detail('p1');

  assert.deepStrictEqual(first.summaryPoints, { good: ['고기 질', '숯불'], bad: ['가격이 오름'] });
  assert.deepStrictEqual(second.summaryPoints, first.summaryPoints);
  assert.strictEqual(fake.mock.callCount(), 1);
});

test('LLM이 요약만 주면 요약은 쓰고 summaryPoints는 빈 목록이다', async () => {
  addPlaceWithReviews('p2', ['국물이 진함', '반찬이 많음']);
  test.mock.method(llm, 'generateJson', async () => '{"summary":"국물이 진하고 반찬이 많아요"}');

  const body = await detail('p2');

  assert.strictEqual(body.summary, '국물이 진하고 반찬이 많아요');
  assert.deepStrictEqual(body.summaryPoints, { good: [], bad: [] });
});

test('요약이 없으면 summaryPoints도 빈 목록이다', async () => {
  addPlaceWithReviews('p3', ['혼자 남긴 글이에요']);

  const body = await detail('p3');

  assert.strictEqual(body.summary, null);
  assert.deepStrictEqual(body.summaryPoints, { good: [], bad: [] });
});

test('좋은 점을 더하기 전에 저장한 요약은 한 번 다시 만든다', async () => {
  addPlaceWithReviews('p4', ['예전 요약 하나', '예전 요약 둘']);
  const { summaryKey: keyOf } = require('../shared/placeSummary');
  // 예전 모양(good, bad 없음)으로 저장된 요약을 흉내 낸다
  store.getPlace('p4').summary = { text: '예전 요약', key: keyOf(store.getReviewsByPlace('p4')), createdAt: '2026-11-20T00:00:00.000Z' };
  const fake = test.mock.method(llm, 'generateJson', async () => '{"summary":"새 요약이에요","good":["새로 뽑음"],"bad":[]}');

  const body = await detail('p4');
  await detail('p4');

  assert.strictEqual(body.summary, '새 요약이에요');
  assert.deepStrictEqual(body.summaryPoints, { good: ['새로 뽑음'], bad: [] });
  assert.strictEqual(fake.mock.callCount(), 1);
});
