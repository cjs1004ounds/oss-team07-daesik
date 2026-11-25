const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LIVE_MINUTES, isKind, isLive, hasRecentReport, summarizeLive, pruneOld } = require('../shared/liveStatus');

const NOW = new Date('2026-11-25T03:00:00.000Z');
const MINUTE = 60 * 1000;

function minutesAgo(minutes) {
  return new Date(NOW.getTime() - minutes * MINUTE).toISOString();
}

function report(kind, anonId, minutes, placeId = 'p1') {
  return { placeId: placeId, kind: kind, anonId: anonId, createdAt: minutesAgo(minutes) };
}

// 함수

test('제보 종류는 waiting과 seats만이다', () => {
  assert.strictEqual(isKind('waiting'), true);
  assert.strictEqual(isKind('seats'), true);
  assert.strictEqual(isKind('crowded'), false);
  assert.strictEqual(isKind(undefined), false);
});

test(`${LIVE_MINUTES}분이 되기 전까지만 보이고, 미래 시각이나 잘못된 시각은 안 보인다`, () => {
  assert.strictEqual(isLive(report('waiting', 'a', 0), NOW), true);
  assert.strictEqual(isLive(report('waiting', 'a', LIVE_MINUTES - 0.01), NOW), true);
  assert.strictEqual(isLive(report('waiting', 'a', LIVE_MINUTES), NOW), false);
  assert.strictEqual(isLive(report('waiting', 'a', -5), NOW), false);
  assert.strictEqual(isLive({ createdAt: '어제' }, NOW), false);
});

test('같은 사람이 같은 가게에 30분 안에 제보했는지 안다', () => {
  const reports = [report('waiting', 'a', 10), report('seats', 'b', 40)];
  assert.strictEqual(hasRecentReport(reports, 'p1', 'a', NOW), true);
  assert.strictEqual(hasRecentReport(reports, 'p1', 'b', NOW), false);
  assert.strictEqual(hasRecentReport(reports, 'p2', 'a', NOW), false);
  assert.strictEqual(hasRecentReport(undefined, 'p1', 'a', NOW), false);
});

test('30분 안 제보를 종류별로 세고 가장 최근 제보를 알려 준다', () => {
  const reports = [report('waiting', 'a', 20), report('waiting', 'b', 5), report('seats', 'c', 12), report('seats', 'd', 50)];
  assert.deepStrictEqual(summarizeLive(reports, NOW), {
    waiting: 2,
    seats: 1,
    latestKind: 'waiting',
    latestAt: minutesAgo(5),
  });
});

test('같은 사람의 제보는 한 번만 센다', () => {
  const reports = [report('waiting', 'a', 20), report('waiting', 'a', 5)];
  assert.strictEqual(summarizeLive(reports, NOW).waiting, 1);
});

test('30분 안 제보가 없거나 종류가 이상하면 null이다', () => {
  assert.strictEqual(summarizeLive([report('waiting', 'a', 40)], NOW), null);
  assert.strictEqual(summarizeLive([report('crowded', 'a', 1)], NOW), null);
  assert.strictEqual(summarizeLive([], NOW), null);
  assert.strictEqual(summarizeLive(undefined, NOW), null);
});

test('하루가 지난 제보는 지운다', () => {
  const kept = pruneOld([report('waiting', 'a', 10), report('seats', 'b', 24 * 60 + 1), { createdAt: '잘못' }], NOW);
  assert.deepStrictEqual(kept.map((r) => r.anonId), ['a']);
});

// API

const app = require('../server/app');
const store = require('../server/store');

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-status-test-'));
  process.env.DATA_DIR = path.join(dataDir, 'runtime');
  process.env.SEED_DIR = path.join(dataDir, 'seed');
  store.load();
  store.addPlace({ id: 'live-1', name: '상황식당', lat: 37.6195, lng: 127.059, category: '음식점 > 한식' });
  store.addPlace({ id: 'live-2', name: '한도식당', lat: 37.6195, lng: 127.059, category: '음식점 > 한식' });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function postStatus(placeId, body, ip) {
  const res = await fetch(`${baseUrl}/api/places/${placeId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || '198.51.100.1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('제보하면 201이고 가게 상세와 목록에 live가 붙는다', async () => {
  const res = await postStatus('live-1', { kind: 'waiting', anonId: 'p-a' });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.live.waiting, 1);
  assert.strictEqual(res.body.live.latestKind, 'waiting');

  const detail = await (await fetch(`${baseUrl}/api/places/live-1`)).json();
  assert.strictEqual(detail.live.waiting, 1);
  const list = await (await fetch(`${baseUrl}/api/places`)).json();
  assert.strictEqual(list.places.find((p) => p.id === 'live-1').live.waiting, 1);
});

test('다른 사람의 제보는 더해지고, 같은 사람이 30분 안에 다시 하면 409다', async () => {
  const second = await postStatus('live-1', { kind: 'seats', anonId: 'p-b' });
  const again = await postStatus('live-1', { kind: 'seats', anonId: 'p-a' });

  assert.strictEqual(second.body.live.waiting, 1);
  assert.strictEqual(second.body.live.seats, 1);
  assert.strictEqual(second.body.live.latestKind, 'seats');
  assert.strictEqual(again.status, 409);
});

test('제보가 없는 가게는 live가 null이다', async () => {
  const detail = await (await fetch(`${baseUrl}/api/places/live-2`)).json();
  assert.strictEqual(detail.live, null);
});

test('종류나 익명 ID가 잘못되면 400, 없는 가게는 404다', async () => {
  assert.strictEqual((await postStatus('live-1', { kind: 'crowded', anonId: 'x' })).status, 400);
  assert.strictEqual((await postStatus('live-1', { kind: 'waiting' })).status, 400);
  assert.strictEqual((await postStatus('없는가게', { kind: 'waiting', anonId: 'x' })).status, 404);
});

test('같은 IP는 1시간에 20번까지만 제보할 수 있다', async () => {
  const ip = '203.0.113.77';
  for (let i = 0; i < 20; i += 1) {
    assert.strictEqual((await postStatus('live-2', { kind: 'waiting', anonId: 'spam-' + i }, ip)).status, 201);
  }
  const blocked = await postStatus('live-2', { kind: 'waiting', anonId: 'spam-20' }, ip);
  const otherIp = await postStatus('live-2', { kind: 'waiting', anonId: 'normal' }, '198.51.100.99');

  assert.strictEqual(blocked.status, 429);
  assert.strictEqual(otherIp.status, 201);
});
