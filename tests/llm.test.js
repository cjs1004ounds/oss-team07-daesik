const test = require('node:test');
const assert = require('node:assert');

const llm = require('../server/llm');

// 실제 Gemini는 부르지 않는다. 전역 fetch를 가짜로 바꿔서 보내는 요청과 받은 응답 처리만 본다
let savedKey;
let savedModel;

test.beforeEach(() => {
  savedKey = process.env.GEMINI_API_KEY;
  savedModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.GEMINI_MODEL;
});

test.afterEach(() => {
  test.mock.restoreAll();
  if (savedKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = savedKey;
  }
  if (savedModel === undefined) {
    delete process.env.GEMINI_MODEL;
  } else {
    process.env.GEMINI_MODEL = savedModel;
  }
});

function fakeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status: status, json: async () => body };
}

test('키는 헤더로 보내고 주소에는 넣지 않는다. JSON으로 답하게 요청한다', async () => {
  const fake = test.mock.method(global, 'fetch', async () =>
    fakeResponse(200, { candidates: [{ content: { parts: [{ text: '{"verdict":"ok"}' }] } }] })
  );

  const text = await llm.generateJson('물어볼 문장');

  assert.strictEqual(text, '{"verdict":"ok"}');
  const [url, options] = fake.mock.calls[0].arguments;
  assert.ok(url.includes(llm.DEFAULT_MODEL + ':generateContent'));
  assert.strictEqual(url.includes('test-key'), false);
  assert.strictEqual(options.headers['x-goog-api-key'], 'test-key');
  const body = JSON.parse(options.body);
  assert.strictEqual(body.contents[0].parts[0].text, '물어볼 문장');
  assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
});

test('GEMINI_MODEL을 정하면 그 모델을 부른다', async () => {
  process.env.GEMINI_MODEL = 'gemini-test-model';
  const fake = test.mock.method(global, 'fetch', async () =>
    fakeResponse(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] })
  );

  await llm.generateJson('문장');
  assert.ok(fake.mock.calls[0].arguments[0].includes('gemini-test-model:generateContent'));
});

test('키가 없으면 부르지 않고 오류를 던진다', async () => {
  delete process.env.GEMINI_API_KEY;
  const fake = test.mock.method(global, 'fetch', async () => fakeResponse(200, {}));

  await assert.rejects(() => llm.generateJson('문장'), /GEMINI_API_KEY/);
  assert.strictEqual(fake.mock.callCount(), 0);
});

test('Gemini가 오류 상태를 주면 상태 코드만 담은 오류를 던진다', async () => {
  test.mock.method(global, 'fetch', async () => fakeResponse(429, { error: { message: 'quota' } }));
  await assert.rejects(() => llm.generateJson('문장'), (err) => {
    assert.match(err.message, /429/);
    assert.strictEqual(err.message.includes('test-key'), false);
    return true;
  });
});

test('응답에 글자가 없으면 오류를 던진다', async () => {
  test.mock.method(global, 'fetch', async () => fakeResponse(200, { candidates: [] }));
  await assert.rejects(() => llm.generateJson('문장'), /글자가 없습니다/);
});
