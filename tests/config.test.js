const test = require('node:test');
const assert = require('node:assert');

const app = require('../server/app');

let server;
let baseUrl;

// 테스트가 환경 변수를 바꾸기 때문에 끝나면 원래 값으로 돌려놓는다
const savedJsKey = process.env.KAKAO_JS_KEY;
const savedRestKey = process.env.KAKAO_REST_API_KEY;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
  restore('KAKAO_JS_KEY', savedJsKey);
  restore('KAKAO_REST_API_KEY', savedRestKey);
});

function restore(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test('GET /api/config 는 환경 변수의 카카오 JavaScript 키를 돌려준다', async () => {
  process.env.KAKAO_JS_KEY = 'test-js-key';

  const res = await fetch(`${baseUrl}/api/config`);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(body, { kakaoJsKey: 'test-js-key' });
});

test('키가 없으면 빈 문자열을 돌려준다', async () => {
  delete process.env.KAKAO_JS_KEY;

  const res = await fetch(`${baseUrl}/api/config`);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(body, { kakaoJsKey: '' });
});

test('서버용 REST 키는 응답에 들어가지 않는다', async () => {
  process.env.KAKAO_JS_KEY = 'test-js-key';
  process.env.KAKAO_REST_API_KEY = 'secret-rest-key';

  const res = await fetch(`${baseUrl}/api/config`);
  const text = await res.text();

  assert.ok(!text.includes('secret-rest-key'));
});
