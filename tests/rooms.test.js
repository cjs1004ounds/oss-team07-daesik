const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const store = require('../server/store');

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-test-'));
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

function place(id, name) {
  return { id: id, name: name, lat: 37.62, lng: 127.058, category: '음식점 > 한식' };
}

const CANDIDATES = [place('1', '윤스쿡'), place('2', '광운분식'), place('3', '국밥집')];

async function call(method, url, body) {
  const res = await fetch(baseUrl + url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function createRoom(owner) {
  const res = await call('POST', '/api/rooms', { anonId: owner || 'owner', candidates: CANDIDATES });
  return res.body.room;
}

function votesOf(room) {
  const result = {};
  for (const candidate of room.candidates) {
    result[candidate.placeId] = candidate.votes;
  }
  return result;
}

test('방을 만들면 201과 6자리 방 코드, 표 0개인 후보가 나온다', async () => {
  const res = await call('POST', '/api/rooms', { anonId: 'owner', candidates: CANDIDATES });

  assert.strictEqual(res.status, 201);
  assert.match(res.body.room.code, /^[A-Z2-9]{6}$/);
  assert.deepStrictEqual(res.body.room.candidates.map((c) => c.name), ['윤스쿡', '광운분식', '국밥집']);
  assert.deepStrictEqual(votesOf(res.body.room), { 1: 0, 2: 0, 3: 0 });
  assert.strictEqual(res.body.room.totalVotes, 0);
  assert.strictEqual(res.body.room.closed, false);
  assert.strictEqual(res.body.room.winnerId, null);
});

test('응답에는 만든 사람과 투표한 사람의 익명 ID가 없다', async () => {
  const room = await createRoom('secret-owner');
  const voted = await call('POST', `/api/rooms/${room.code}/votes`, { anonId: 'secret-voter', placeId: '1' });

  const text = JSON.stringify(voted.body);
  assert.strictEqual(text.includes('secret-owner'), false);
  assert.strictEqual(text.includes('secret-voter'), false);
});

test('익명 ID가 없거나 후보가 잘못되면 방을 만들지 않는다', async () => {
  assert.strictEqual((await call('POST', '/api/rooms', { candidates: CANDIDATES })).status, 400);
  assert.strictEqual((await call('POST', '/api/rooms', { anonId: 'owner', candidates: [CANDIDATES[0]] })).status, 400);
  assert.strictEqual((await call('POST', '/api/rooms', { anonId: 'owner', candidates: [CANDIDATES[0], CANDIDATES[0]] })).status, 400);
  assert.strictEqual((await call('POST', '/api/rooms', { anonId: 'owner' })).status, 400);
});

test('세 명이 투표하고 한 명이 바꾸면 바뀐 표로 센다, 만든 사람이 마감하면 가장 많은 가게로 정해진다', async () => {
  const room = await createRoom();
  const url = `/api/rooms/${room.code}`;

  await call('POST', `${url}/votes`, { anonId: 'a', placeId: '1' });
  await call('POST', `${url}/votes`, { anonId: 'b', placeId: '2' });
  await call('POST', `${url}/votes`, { anonId: 'c', placeId: '2' });
  const changed = await call('POST', `${url}/votes`, { anonId: 'a', placeId: '2' });

  assert.strictEqual(changed.status, 200);
  assert.deepStrictEqual(votesOf(changed.body.room), { 1: 0, 2: 3, 3: 0 });
  assert.strictEqual(changed.body.room.totalVotes, 3);

  const closed = await call('POST', `${url}/close`, { anonId: 'owner' });
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(closed.body.room.closed, true);
  assert.strictEqual(closed.body.room.winnerId, '2');
  assert.strictEqual(typeof closed.body.room.closedAt, 'string');

  const seen = await call('GET', url);
  assert.strictEqual(seen.body.room.winnerId, '2');
});

test('표가 같으면 먼저 후보에 오른 가게로 정해진다 (도보 시간이 아직 없음)', async () => {
  const room = await createRoom();
  const url = `/api/rooms/${room.code}`;

  await call('POST', `${url}/votes`, { anonId: 'a', placeId: '3' });
  await call('POST', `${url}/votes`, { anonId: 'b', placeId: '2' });
  const closed = await call('POST', `${url}/close`, { anonId: 'owner' });

  assert.strictEqual(closed.body.room.winnerId, '2');
});

test('방 코드는 소문자로 들어와도 같은 방이다', async () => {
  const room = await createRoom();
  const res = await call('GET', `/api/rooms/${room.code.toLowerCase()}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.room.code, room.code);
});

test('없는 방이나 모양이 틀린 방 코드는 404다', async () => {
  assert.strictEqual((await call('GET', '/api/rooms/ZZZZZZ')).status, 404);
  assert.strictEqual((await call('GET', '/api/rooms/abc')).status, 404);
  assert.strictEqual((await call('POST', '/api/rooms/ZZZZZZ/votes', { anonId: 'a', placeId: '1' })).status, 404);
  assert.strictEqual((await call('POST', '/api/rooms/ZZZZZZ/close', { anonId: 'owner' })).status, 404);
});

test('후보가 아닌 가게에는 투표할 수 없고, 익명 ID가 없어도 안 된다', async () => {
  const room = await createRoom();
  const url = `/api/rooms/${room.code}/votes`;

  assert.strictEqual((await call('POST', url, { anonId: 'a', placeId: '999' })).status, 400);
  assert.strictEqual((await call('POST', url, { anonId: 'a' })).status, 400);
  assert.strictEqual((await call('POST', url, { placeId: '1' })).status, 400);
});

test('만든 사람이 아니면 마감할 수 없다', async () => {
  const room = await createRoom();
  await call('POST', `/api/rooms/${room.code}/votes`, { anonId: 'a', placeId: '1' });

  const res = await call('POST', `/api/rooms/${room.code}/close`, { anonId: 'someone' });
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await call('GET', `/api/rooms/${room.code}`)).body.room.closed, false);
});

test('표가 하나도 없으면 마감할 수 없다', async () => {
  const room = await createRoom();
  const res = await call('POST', `/api/rooms/${room.code}/close`, { anonId: 'owner' });

  assert.strictEqual(res.status, 409);
  assert.match(res.body.error, /표가 하나도 없/);
});

test('마감된 방에는 투표할 수 없고 다시 마감할 수도 없다', async () => {
  const room = await createRoom();
  const url = `/api/rooms/${room.code}`;
  await call('POST', `${url}/votes`, { anonId: 'a', placeId: '1' });
  await call('POST', `${url}/close`, { anonId: 'owner' });

  assert.strictEqual((await call('POST', `${url}/votes`, { anonId: 'b', placeId: '2' })).status, 409);
  assert.strictEqual((await call('POST', `${url}/close`, { anonId: 'owner' })).status, 409);
  assert.strictEqual((await call('GET', url)).body.room.winnerId, '1');
});

test('방은 파일에 저장돼서 서버를 다시 켜도 남는다', async () => {
  const room = await createRoom();
  await call('POST', `/api/rooms/${room.code}/votes`, { anonId: 'a', placeId: '3' });
  store.load();

  const res = await call('GET', `/api/rooms/${room.code}`);
  assert.deepStrictEqual(votesOf(res.body.room), { 1: 0, 2: 0, 3: 1 });
});
