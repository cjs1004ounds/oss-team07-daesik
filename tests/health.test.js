const test = require('node:test');
const assert = require('node:assert');

const app = require('../server/app');

// 빈 포트에 서버를 잠깐 띄우고, 테스트가 끝나면 닫는다
let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
});

test('GET /api/health 는 200과 status ok를 돌려준다', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(body, { status: 'ok' });
});

test('응답에 X-Powered-By 헤더가 없다', async () => {
  const res = await fetch(`${baseUrl}/api/health`);

  assert.strictEqual(res.headers.get('x-powered-by'), null);
});

test('없는 API 경로는 404와 JSON을 돌려준다', async () => {
  const res = await fetch(`${baseUrl}/api/nothing`);
  const body = await res.json();

  assert.strictEqual(res.status, 404);
  assert.ok(body.error);
});

test('깨진 JSON을 보내면 400을 돌려준다', async () => {
  const res = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{깨진 JSON',
  });

  assert.strictEqual(res.status, 400);
});

test('public 폴더의 index.html을 내려준다', async () => {
  const res = await fetch(`${baseUrl}/`);
  const text = await res.text();

  assert.strictEqual(res.status, 200);
  assert.ok(text.includes('<html'));
});
