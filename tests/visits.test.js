const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daesik-visits-test-'));
process.env.DATA_DIR = tempDir;

const store = require('../server/store');
const app = require('../server/app');

const samplePlace = {
  id: '12345678',
  name: '광운식당',
  lat: 37.6195,
  lng: 127.0589,
  category: '음식점 > 한식',
};

describe('POST /api/visits', () => {
  let server;
  let baseUrl;

  before(async () => {
    store.load();
    store.addPlace(samplePlace);
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('등록된 가게에 또 갈래요(again: true)를 저장하고 anonId는 응답에서 뺀다', async () => {
    const res = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: '12345678',
        again: true,
        anonId: 'anon-visit-1',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.visit.id);
    assert.equal(body.visit.placeId, '12345678');
    assert.equal(body.visit.again, true);
    assert.equal(body.visit.roomCode, null);
    assert.equal(body.visit.verified, false);
    assert.equal(body.visit.anonId, undefined);
    assert.ok(body.visit.createdAt);
  });

  it('글쎄요(again: false)와 방 코드(roomCode)를 함께 저장한다', async () => {
    const res = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: '12345678',
        again: false,
        anonId: 'anon-visit-2',
        roomCode: 'ROOM-ABC',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.visit.again, false);
    assert.equal(body.visit.roomCode, 'ROOM-ABC');
  });

  it('교내 인증된 익명 ID가 남긴 응답은 verified가 true로 저장된다', async () => {
    store.saveVerification('anon-verified-user', 'wifi');

    const res = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: '12345678',
        again: true,
        anonId: 'anon-verified-user',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.visit.verified, true);
  });

  it('처음 기록되는 가게 정보를 place로 함께 보내면 가게와 응답이 같이 저장된다', async () => {
    const newPlace = {
      id: '88888881',
      name: '새로생긴분식',
      lat: 37.6201,
      lng: 127.0591,
      category: '음식점 > 분식',
    };

    const res = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: newPlace,
        again: true,
        anonId: 'anon-visit-3',
      }),
    });

    assert.equal(res.status, 201);
    assert.equal(store.getPlace('88888881').name, '새로생긴분식');
    assert.equal(store.getVisitsByPlace('88888881').length, 1);
  });

  it('같은 날 같은 가게에 같은 익명 ID가 다시 응답하면 409를 반환한다 (R7)', async () => {
    const targetPlace = { ...samplePlace, id: '88888882' };

    const first = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: targetPlace,
        again: true,
        anonId: 'anon-dup-visit',
      }),
    });
    assert.equal(first.status, 201);

    const second = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: '88888882',
        again: false,
        anonId: 'anon-dup-visit',
      }),
    });
    assert.equal(second.status, 409);
    assert.equal(store.getVisitsByPlace('88888882').length, 1);
  });

  it('같은 날 한 줄 추천을 남겼어도 다녀왔어요 응답은 별도로 저장된다 (R7)', async () => {
    const targetPlace = { ...samplePlace, id: '88888883' };

    const reviewRes = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: targetPlace,
        text: '한 줄 추천 먼저 남깁니다',
        anonId: 'anon-both-user',
      }),
    });
    assert.equal(reviewRes.status, 201);

    const visitRes = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: '88888883',
        again: true,
        anonId: 'anon-both-user',
      }),
    });
    assert.equal(visitRes.status, 201);
  });

  it('없는 가게 ID를 보내면 404를 반환한다', async () => {
    const res = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: '99999999',
        again: true,
        anonId: 'anon-visit-4',
      }),
    });

    assert.equal(res.status, 404);
  });

  it('again이 불리언이 아니거나 익명 ID가 없으면 400을 반환한다', async () => {
    const badAgain = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: '12345678',
        again: 'yes',
        anonId: 'anon-visit-5',
      }),
    });
    assert.equal(badAgain.status, 400);

    const noAnon = await fetch(`${baseUrl}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: '12345678',
        again: true,
        anonId: '   ',
      }),
    });
    assert.equal(noAnon.status, 400);
  });
});