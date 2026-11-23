const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = require('../server/app');
const kakao = require('../server/kakao');
const store = require('../server/store');

// 실제 카카오 API는 부르지 않는다.
// kakao.searchPlaces를 가짜 함수로 바꿔 놓고 몇 번 불렸는지 센다
let server;
let baseUrl;

let dataDir;

test.before(async () => {
  // 기록으로 찾기가 실제 data 폴더를 읽지 않게, 빈 임시 폴더로 시작한다
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-search-test-'));
  process.env.DATA_DIR = path.join(dataDir, 'runtime');
  process.env.SEED_DIR = path.join(dataDir, 'seed');
  store.load();

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test.afterEach(() => {
  test.mock.restoreAll();
});

function search(q) {
  return fetch(`${baseUrl}/api/places/search?q=${encodeURIComponent(q)}`);
}

const FAKE_PLACES = [
  { id: '1', name: '테스트식당', lat: 37.62, lng: 127.06, category: '음식점 > 한식', address: '서울 노원구' },
];

test('검색하면 places 배열을 돌려준다', async () => {
  test.mock.method(kakao, 'searchPlaces', async () => FAKE_PLACES);

  const res = await search('검색 테스트');
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(body, { places: FAKE_PLACES });
});

test('같은 검색어로 두 번 요청하면 카카오는 한 번만 부른다', async () => {
  const fake = test.mock.method(kakao, 'searchPlaces', async () => FAKE_PLACES);

  await search('캐시 테스트');
  const res = await search('  캐시   테스트 ');
  const body = await res.json();

  assert.strictEqual(fake.mock.callCount(), 1);
  assert.deepStrictEqual(body, { places: FAKE_PLACES });
});

test('검색어가 없거나 공백뿐이면 400이고 카카오를 부르지 않는다', async () => {
  const fake = test.mock.method(kakao, 'searchPlaces', async () => FAKE_PLACES);

  const noQuery = await fetch(`${baseUrl}/api/places/search`);
  const blank = await search('   ');

  assert.strictEqual(noQuery.status, 400);
  assert.strictEqual(blank.status, 400);
  assert.strictEqual(fake.mock.callCount(), 0);
});

test('카카오 호출이 실패하면 502를 돌려주고, 실패한 결과는 저장하지 않는다', async () => {
  const fake = test.mock.method(kakao, 'searchPlaces', async () => {
    throw new Error('테스트용 실패');
  });

  const first = await search('실패 테스트');
  const body = await first.json();
  await search('실패 테스트');

  assert.strictEqual(first.status, 502);
  assert.ok(body.error);
  assert.strictEqual(fake.mock.callCount(), 2);
});

test('카카오 키가 없으면 502를 돌려주고 서버는 계속 동작한다', async () => {
  const savedKey = process.env.KAKAO_REST_API_KEY;
  delete process.env.KAKAO_REST_API_KEY;

  const res = await search('키 없음 테스트');
  const health = await fetch(`${baseUrl}/api/health`);

  if (savedKey !== undefined) {
    process.env.KAKAO_REST_API_KEY = savedKey;
  }

  assert.strictEqual(res.status, 502);
  assert.strictEqual(health.status, 200);
});

test('카카오가 준 장소를 우리 형식으로 바꾼다', () => {
  const place = kakao.toPlace({
    id: '123',
    place_name: '테스트식당',
    x: '127.06',
    y: '37.62',
    category_name: '음식점 > 한식',
    road_address_name: '서울 노원구 테스트로 1',
    address_name: '서울 노원구 테스트동 1',
  });

  assert.deepStrictEqual(place, {
    id: '123',
    name: '테스트식당',
    lat: 37.62,
    lng: 127.06,
    category: '음식점 > 한식',
    address: '서울 노원구 테스트로 1',
  });
});

test('도로명 주소가 비어 있으면 지번 주소를 쓴다', () => {
  const place = kakao.toPlace({
    id: '123',
    place_name: '테스트식당',
    x: '127.06',
    y: '37.62',
    category_name: '음식점',
    road_address_name: '',
    address_name: '서울 노원구 테스트동 1',
  });

  assert.strictEqual(place.address, '서울 노원구 테스트동 1');
});

// 기록에 적힌 메뉴로 찾기

function addRecord(place, text) {
  store.addPlace(place);
  store.addReview({ placeId: place.id, text: text, price: null, tags: [], anonId: 'anon-test' });
}

const RECORD_PLACE = { id: '500', name: '기록식당', lat: 37.6203, lng: 127.0584, category: '음식점 > 일식 > 돈까스,우동' };

test('기록에 검색어가 적힌 가게가 카카오 결과 앞에 붙는다', async () => {
  addRecord(RECORD_PLACE, '두루치기 7천원인데 양 많음');
  test.mock.method(kakao, 'searchPlaces', async () => FAKE_PLACES);

  const body = await (await search('두루치기')).json();

  assert.deepStrictEqual(body.places.map((p) => p.id), ['500', '1']);
  assert.strictEqual(body.places[0].fromRecords, true);
  assert.strictEqual(body.places[1].fromRecords, undefined);
});

test('카카오 결과를 저장해 둔 뒤에 남긴 기록도 바로 찾힌다', async () => {
  test.mock.method(kakao, 'searchPlaces', async () => FAKE_PLACES);
  const before = await (await search('오므라이스')).json();
  addRecord({ ...RECORD_PLACE, id: '501', name: '새기록식당' }, '오므라이스 소스 진함');
  const after = await (await search('오므라이스')).json();

  assert.deepStrictEqual(before.places.map((p) => p.id), ['1']);
  assert.deepStrictEqual(after.places.map((p) => p.id), ['501', '1']);
});

test('카카오 호출이 실패해도 기록으로 찾은 가게가 있으면 200으로 돌려준다', async () => {
  addRecord({ ...RECORD_PLACE, id: '502', name: '쫄면집' }, '쫄면 새콤달콤');
  test.mock.method(kakao, 'searchPlaces', async () => {
    throw new Error('테스트용 실패');
  });

  const res = await search('쫄면');
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(body.places.map((p) => p.id), ['502']);
});
