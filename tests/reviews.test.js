const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const app = require('../server/app');
const store = require('../server/store');

describe('POST /api/reviews 한 줄 추천 저장 API', () => {
  let server;
  let baseUrl;
  let tempDir;
  let prevDataDir;

  before(async () => {
    prevDataDir = process.env.DATA_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-reviews-test-'));
    process.env.DATA_DIR = tempDir;
    store.load();

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (prevDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = prevDataDir;
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const samplePlace = {
    id: '99999999',
    name: '광운테스트식당',
    lat: 37.6195,
    lng: 127.0589,
    category: '음식점 > 한식',
  };

  it('올바른 값을 보내면 201로 저장되고 처음 기록되는 가게도 함께 저장된다', async () => {
    const res = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: samplePlace,
        text: '제육 7천원인데 양 많음 혼밥하기 좋음',
        price: 7000,
        tags: ['양 많음', '혼밥'],
        anonId: 'anon-test-1',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();

    assert.ok(typeof body.review.id === 'string' && body.review.id.length > 0);
    assert.equal(body.review.placeId, samplePlace.id);
    assert.equal(body.review.text, '제육 7천원인데 양 많음 혼밥하기 좋음');
    assert.equal(body.review.price, 7000);
    assert.deepEqual(body.review.tags, ['양 많음', '혼밥']);
    assert.ok(typeof body.review.createdAt === 'string');
    assert.equal(body.review.anonId, undefined);

    // 저장 모듈에 가게와 추천글이 모두 기록되었는지 확인
    const savedPlace = store.getPlace(samplePlace.id);
    assert.deepEqual(savedPlace, samplePlace);

    const savedReviews = store.getReviewsByPlace(samplePlace.id);
    assert.equal(savedReviews.length, 1);
    assert.equal(savedReviews[0].text, '제육 7천원인데 양 많음 혼밥하기 좋음');
    assert.equal(savedReviews[0].anonId, 'anon-test-1');

    // GET /api/places/:id가 구현되어 있다면 응답에서도 확인
    const detailRes = await fetch(`${baseUrl}/api/places/${samplePlace.id}`);
    if (detailRes.status !== 404) {
      assert.equal(detailRes.status, 200);
      const detailBody = await detailRes.json();
      assert.equal(detailBody.place.id, samplePlace.id);
      assert.equal(detailBody.reviews.length, 1);
      assert.equal(detailBody.reviews[0].anonId, undefined);
    }
  });

  it('가격과 태그를 생략하면 null과 빈 배열로 저장된다', async () => {
    const res = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: samplePlace,
        text: '가게 분위기 조용하고 깔끔함',
        anonId: 'anon-test-2',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.review.price, null);
    assert.deepEqual(body.review.tags, []);
  });

  it('4자짜리 문장을 보내면 400을 반환하고 저장되지 않는다', async () => {
    const newPlace = { ...samplePlace, id: '88888888', name: '미저장식당' };
    const res = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: newPlace,
        text: '맛있어요', // 4자
        price: 7000,
        tags: ['혼밥'],
        anonId: 'anon-test-3',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
    assert.equal(store.getPlace(newPlace.id), null);
    assert.equal(store.getReviewsByPlace(newPlace.id).length, 0);
  });

  it('음수 가격을 보내면 400을 반환하고 저장되지 않는다', async () => {
    const newPlace = { ...samplePlace, id: '77777777', name: '음수가격식당' };
    const res = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: newPlace,
        text: '음수 가격 테스트 문장입니다',
        price: -1000,
        tags: ['가성비'],
        anonId: 'anon-test-4',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
    assert.equal(store.getPlace(newPlace.id), null);
    assert.equal(store.getReviewsByPlace(newPlace.id).length, 0);
  });

  it('가게 정보나 익명 ID가 빠지면 400을 반환한다', async () => {
    const noPlaceRes = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '가게 정보 누락 테스트',
        anonId: 'anon-test-5',
      }),
    });
    assert.equal(noPlaceRes.status, 400);

    const noAnonRes = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: samplePlace,
        text: '익명 ID 누락 테스트',
      }),
    });
    assert.equal(noAnonRes.status, 400);
  });

  it('같은 익명 ID가 같은 가게에 오늘 다시 한 줄 추천을 남기면 409를 반환한다', async () => {
    const targetPlace = { ...samplePlace, id: '77777771' };

    const firstRes = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: targetPlace,
        text: '첫 번째 한 줄 추천입니다',
        anonId: 'anon-dup-user',
      }),
    });
    assert.equal(firstRes.status, 201);

    const secondRes = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: targetPlace,
        text: '같은 날 두 번째 추천 시도',
        anonId: 'anon-dup-user',
      }),
    });
    assert.equal(secondRes.status, 409);

    const body = await secondRes.json();
    assert.ok(body.error);
    assert.equal(store.getReviewsByPlace('77777771').length, 1);
  });

  it('같은 날이라도 다른 가게이거나 다른 익명 ID면 저장된다', async () => {
    const placeA = { ...samplePlace, id: '77777772' };
    const placeB = { ...samplePlace, id: '77777773' };

    const res1 = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: placeA,
        text: 'A 가게 첫 추천 문장',
        anonId: 'anon-user-a',
      }),
    });
    assert.equal(res1.status, 201);

    // 같은 사람, 다른 가게
    const res2 = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: placeB,
        text: 'B 가게 첫 추천 문장',
        anonId: 'anon-user-a',
      }),
    });
    assert.equal(res2.status, 201);

    // 다른 사람, 같은 가게
    const res3 = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: placeA,
        text: 'A 가게 다른 사람 추천',
        anonId: 'anon-user-b',
      }),
    });
    assert.equal(res3.status, 201);
  });

  it('교내 인증을 하지 않은 익명 ID로 저장하면 verified가 false다', async () => {
    const targetPlace = { ...samplePlace, id: '88887771' };

    const res = await fetch(`${baseUrl}/api/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ place: targetPlace, text: '미인증 사용자 한 줄 추천 테스트', anonId: 'anon-unverified-review', }), });  assert.equal(res.status, 201); const body = await res.json(); assert.equal(body.review.verified, false); assert.equal(store.getReviewsByPlace('88887771')[0].verified, false); });  it('교내 인증된 익명 ID로 저장하면 verified가 true다', async () => { const targetPlace = { ...samplePlace, id: '88887772' }; store.saveVerification('anon-verified-review', 'wifi');  const res = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: targetPlace,
        text: '교내 인증 사용자 한 줄 추천 테스트',
        anonId: 'anon-verified-review',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.review.verified, true);
    assert.equal(store.getReviewsByPlace('88887772')[0].verified, true);
  });
});