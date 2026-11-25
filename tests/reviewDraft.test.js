const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { buildDraftPrompt, parseDraftResponse } = require('../shared/reviewDraft');
const llm = require('../server/llm');
const app = require('../server/app');

describe('R10 한 줄 추천 LLM 응답 검사 (shared/reviewDraft.js)', () => {
  it('올바른 JSON에서 가격과 허용된 태그를 추출한다', () => {
    const raw = JSON.stringify({
      price: 7000,
      tags: ['양 많음', '혼밥'],
    });

    assert.deepEqual(parseDraftResponse(raw), {
      price: 7000,
      tags: ['양 많음', '혼밥'],
    });
  });

  it('JSON이 아니거나 객체가 아니면 가격 null, 태그 빈 배열을 반환한다', () => {
    assert.deepEqual(parseDraftResponse('가격은 7000원이고 혼밥하기 좋아요'), {
      price: null,
      tags: [],
    });
    assert.deepEqual(parseDraftResponse(''), { price: null, tags: [] });
    assert.deepEqual(parseDraftResponse('[]'), { price: null, tags: [] });
    assert.deepEqual(parseDraftResponse('null'), { price: null, tags: [] });
    assert.deepEqual(parseDraftResponse(null), { price: null, tags: [] });
  });

  it('가격이 R6 범위(1,000~100,000 정수) 밖이면 가격만 버리고 태그는 유지한다', () => {
    assert.deepEqual(
      parseDraftResponse(JSON.stringify({ price: 999, tags: ['가성비'] })),
      { price: null, tags: ['가성비'] }
    );
    assert.deepEqual(
      parseDraftResponse(JSON.stringify({ price: 100001, tags: ['단체 가능'] })),
      { price: null, tags: ['단체 가능'] }
    );
    assert.deepEqual(
      parseDraftResponse(JSON.stringify({ price: 7500.5, tags: ['혼밥'] })),
      { price: null, tags: ['혼밥'] }
    );
    assert.deepEqual(
      parseDraftResponse(JSON.stringify({ price: '7000', tags: ['매움'] })),
      { price: null, tags: ['매움'] }
    );
  });

  it('가격 경계값(1,000원, 100,000원)은 정상 허용한다', () => {
    assert.equal(parseDraftResponse(JSON.stringify({ price: 1000, tags: [] })).price, 1000);
    assert.equal(parseDraftResponse(JSON.stringify({ price: 100000, tags: [] })).price, 100000);
  });

  it('목록에 없는 태그, 중복 태그, 3개 초과 태그는 걸러낸다', () => {
    const raw = JSON.stringify({
      price: 8500,
      tags: ['존맛탱', '양 많음', '양 많음', '혼밥', '가성비', '빨리 나옴'],
    });

    assert.deepEqual(parseDraftResponse(raw), {
      price: 8500,
      tags: ['양 많음', '혼밥', '가성비'],
    });
  });

  it('프롬프트에 사용자 문장과 가게 정보, 지시 무시 안내가 포함된다', () => {
    const prompt = buildDraftPrompt({
      text: '제육 7천원 양 많음',
      placeName: '광운식당',
      category: '음식점 > 한식',
    });

    assert.ok(prompt.includes('제육 7천원 양 많음'));
    assert.ok(prompt.includes('광운식당'));
    assert.ok(prompt.includes('음식점 > 한식'));
    assert.ok(prompt.includes('지시'));
  });
});

describe('POST /api/reviews/draft 한 줄 초안 채우기 API', () => {
  let server;
  let baseUrl;
  let originalGenerateJson;

  before(async () => {
    originalGenerateJson = llm.generateJson;
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  beforeEach(() => {
    llm.resetLimits();
  });

  afterEach(() => {
    llm.generateJson = originalGenerateJson;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('LLM이 돌려준 JSON을 R10으로 걸러 초안을 반환한다', async () => {
    llm.generateJson = async () =>
      JSON.stringify({
        price: 7000,
        tags: ['양 많음', '없는태그', '혼밥'],
      });

    const res = await fetch(`${baseUrl}/api/reviews/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '제육 7천원인데 양 많음 혼밥하기 좋음', placeName: '광운식당', category: '음식점 > 한식', }), });  assert.equal(res.status, 200); const body = await res.json(); assert.equal(body.source, 'llm'); assert.deepEqual(body.draft, { price: 7000, tags: ['양 많음', '혼밥'], }); });  it('LLM 키가 없거나 호출이 실패해도 200과 빈 초안을 돌려준다', async () => { llm.generateJson = async () => { throw new Error('GEMINI_API_KEY가 없습니다.'); };  const res = await fetch(`${baseUrl}/api/reviews/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '제육 7천원인데 양 많음',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'empty');
    assert.deepEqual(body.draft, { price: null, tags: [] });
    assert.ok(typeof body.message === 'string' && body.message.length > 0);
  });

  it('문장이 비어 있거나 100자를 넘으면 400을 반환한다', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/reviews/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '   ' }), }); assert.equal(emptyRes.status, 400);  const longRes = await fetch(`${baseUrl}/api/reviews/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '가'.repeat(101) }),
    });
    assert.equal(longRes.status, 400);
  });
});