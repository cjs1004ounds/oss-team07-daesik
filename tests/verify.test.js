const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const store = require('../server/store');

// 예시 IP는 문서용으로 정해진 대역을 쓴다. 203.0.113.x를 학교 대역으로 본다
const CAMPUS_IP = '203.0.113.55';
const OTHER_IP = '198.51.100.7';

// 캠퍼스 가운데 근처(80주년기념관)와 석계역 근처 좌표
const ON_CAMPUS = { lat: 37.61993, lng: 127.05871, accuracy: 30 };
const OFF_CAMPUS = { lat: 37.6148, lng: 127.0657, accuracy: 30 };

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
  process.env.DATA_DIR = dataDir;
  process.env.SEED_DIR = path.join(dataDir, 'seed');
  process.env.CAMPUS_IP_PREFIXES = '203.0.113.';
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

// 테스트 요청은 서버 자신(127.0.0.1)에서 가므로, 배포 서버의 nginx처럼 X-Forwarded-For로 접속 IP를 정해 보낸다
function verify(body, forwardedFor) {
  return fetch(`${baseUrl}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor || OTHER_IP },
    body: JSON.stringify(body),
  });
}

function getStatus(anonId) {
  return fetch(`${baseUrl}/api/verify/${encodeURIComponent(anonId)}`);
}

function savedVerifications() {
  const file = path.join(dataDir, 'verifications.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

test('학교 와이파이로 접속하면 위치 없이 인증된다', async () => {
  const res = await verify({ anonId: 'wifi-1' }, CAMPUS_IP);
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.verified, true);
  assert.strictEqual(body.method, 'wifi');
  assert.strictEqual(
    new Date(body.expiresAt) - new Date(body.verifiedAt),
    30 * 24 * 60 * 60 * 1000
  );
});

test('학교 와이파이가 아니고 위치도 없으면 403과 needLocation을 준다', async () => {
  const res = await verify({ anonId: 'none-1' });
  const body = await res.json();

  assert.strictEqual(res.status, 403);
  assert.strictEqual(body.needLocation, true);
  assert.strictEqual(savedVerifications().some((v) => v.anonId === 'none-1'), false);
});

test('캠퍼스 안 위치를 보내면 위치로 인증된다', async () => {
  const res = await verify({ anonId: 'loc-1', ...ON_CAMPUS });
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.method, 'location');
});

test('캠퍼스 밖 위치는 403이고 저장되지 않는다', async () => {
  const res = await verify({ anonId: 'out-1', ...OFF_CAMPUS });
  const body = await res.json();

  assert.strictEqual(res.status, 403);
  assert.strictEqual(typeof body.error, 'string');
  assert.strictEqual(body.needLocation, undefined);
  assert.strictEqual(savedVerifications().some((v) => v.anonId === 'out-1'), false);
});

test('오차가 큰 위치는 캠퍼스 안이어도 403이다', async () => {
  const res = await verify({ anonId: 'rough-1', ...ON_CAMPUS, accuracy: 500 });
  assert.strictEqual(res.status, 403);
});

test('익명 ID가 없거나 좌표가 숫자가 아니면 400이다', async () => {
  assert.strictEqual((await verify({ ...ON_CAMPUS })).status, 400);
  assert.strictEqual((await verify({ anonId: '   ', ...ON_CAMPUS })).status, 400);
  assert.strictEqual((await verify({ anonId: 'x'.repeat(101), ...ON_CAMPUS })).status, 400);
  assert.strictEqual((await verify({ anonId: 'bad-1', lat: '37.62', lng: 127.058, accuracy: 10 })).status, 400);
});

test('X-Forwarded-For 앞에 학교 IP를 지어내 넣어도 실제 접속 IP로 판정한다', async () => {
  // nginx는 받은 헤더 뒤에 실제 접속 IP를 붙인다. 서버는 맨 뒤의 실제 IP를 본다
  const res = await verify({ anonId: 'fake-1' }, `${CAMPUS_IP}, ${OTHER_IP}`);
  assert.strictEqual(res.status, 403);
});

test('저장 파일에는 익명 ID, 방법, 시각만 남고 좌표와 IP는 없다', async () => {
  await verify({ anonId: 'privacy-1', ...ON_CAMPUS });
  await verify({ anonId: 'privacy-2' }, CAMPUS_IP);

  const text = fs.readFileSync(path.join(dataDir, 'verifications.json'), 'utf8');
  for (const verification of JSON.parse(text)) {
    assert.deepStrictEqual(Object.keys(verification).sort(), ['anonId', 'method', 'verifiedAt']);
  }
  assert.strictEqual(text.includes('203.0.113'), false);
  assert.strictEqual(text.includes('37.619'), false);
});

test('인증한 익명 ID는 GET에서 verified: true와 만료 시각이 나온다', async () => {
  await verify({ anonId: 'status-1' }, CAMPUS_IP);
  const res = await getStatus('status-1');
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.verified, true);
  assert.strictEqual(body.method, 'wifi');
  assert.strictEqual(typeof body.expiresAt, 'string');
  assert.strictEqual(body.anonId, undefined);
});

test('인증한 적 없는 익명 ID는 verified: false다', async () => {
  const body = await (await getStatus('never-1')).json();
  assert.deepStrictEqual(body, { verified: false });
});

test('30일이 지난 인증은 verified: false다', async () => {
  // 31일 전에 인증한 기록을 파일에 직접 넣고 다시 읽어 온다
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const list = savedVerifications();
  list.push({ anonId: 'old-1', method: 'wifi', verifiedAt: old });
  fs.writeFileSync(path.join(dataDir, 'verifications.json'), JSON.stringify(list));
  store.load();

  const body = await (await getStatus('old-1')).json();
  assert.deepStrictEqual(body, { verified: false });
});

test('다시 인증하면 기록이 하나로 유지되고 방법과 시각이 바뀐다', async () => {
  await verify({ anonId: 'again-1', ...ON_CAMPUS });
  await verify({ anonId: 'again-1' }, CAMPUS_IP);

  const mine = savedVerifications().filter((v) => v.anonId === 'again-1');
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].method, 'wifi');
});

test('학교 대역이 정해지지 않으면 와이파이로는 통과하지 않는다', async () => {
  const saved = process.env.CAMPUS_IP_PREFIXES;
  delete process.env.CAMPUS_IP_PREFIXES;
  try {
    const res = await verify({ anonId: 'noenv-1' }, CAMPUS_IP);
    assert.strictEqual(res.status, 403);
  } finally {
    process.env.CAMPUS_IP_PREFIXES = saved;
  }
});
