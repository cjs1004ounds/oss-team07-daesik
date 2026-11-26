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

// LLM으로 검색어 넓히기
// llm.generateJson과 kakao.searchPlaces를 가짜로 바꾼다. 카카오는 검색어마다 다른 결과를 준다

const llm = require('../server/llm');

function place(id, name) {
  return { id: id, name: name, lat: 37.62, lng: 127.06, category: '음식점 > 한식', address: '서울 노원구' };
}

function kakaoByQuery(table) {
  return test.mock.method(kakao, 'searchPlaces', async (query) => table[query] || []);
}

// 검색은 LLM을 두 가지 일로 부른다. 검색어 넓히기와 결과 순서 정하기(<가게> 블록이 있다)를 나눠서 센다
function expandCalls(fakeLlm) {
  return fakeLlm.mock.calls.filter((call) => !call.arguments[0].includes('<가게>')).length;
}

function rankCalls(fakeLlm) {
  return fakeLlm.mock.calls.filter((call) => call.arguments[0].includes('<가게>')).length;
}

test('결과가 적으면 LLM이 넓힌 검색어로 더 찾아 뒤에 붙이고 via를 붙인다', async () => {
  kakaoByQuery({
    '넓히기 제육': [place('k1', '본도시락')],
    '넓히기 제육볶음': [place('k2', '윤스쿡'), place('k1', '본도시락')],
    '넓히기 제육덮밥': [place('k3', '한솥도시락')],
  });
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"keywords":["넓히기 제육볶음","넓히기 제육덮밥"]}');

  const body = await (await search('넓히기 제육')).json();

  assert.deepStrictEqual(body.places.map((p) => [p.name, p.via]), [
    ['본도시락', undefined],
    ['윤스쿡', '넓히기 제육볶음'],
    ['한솥도시락', '넓히기 제육덮밥'],
  ]);
  assert.strictEqual(expandCalls(fakeLlm), 1);
});

test('같은 검색어는 LLM을 다시 부르지 않는다', async () => {
  kakaoByQuery({ '다시 국물': [], '다시 국밥': [place('g1', '국밥집')] });
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"keywords":["다시 국밥"]}');

  await search('다시 국물');
  const body = await (await search('  다시   국물 ')).json();

  assert.strictEqual(fakeLlm.mock.callCount(), 1);
  assert.deepStrictEqual(body.places.map((p) => p.name), ['국밥집']);
});

test('결과가 10곳 이상이면 LLM을 부르지 않는다', async () => {
  const ten = Array.from({ length: 10 }, (_, i) => place('t' + i, '가게' + i));
  kakaoByQuery({ '많은 결과': ten });
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"keywords":["다른 것"]}');

  const body = await (await search('많은 결과')).json();

  assert.strictEqual(expandCalls(fakeLlm), 0);
  assert.strictEqual(body.places.length, 10);
});

test('LLM이 실패하거나 이상한 답을 주면 원래 결과만 돌려준다', async () => {
  kakaoByQuery({ '실패 검색': [place('f1', '한식당')], '이상 검색': [place('f2', '분식집')] });

  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('GEMINI_API_KEY가 없습니다.');
  });
  const failed = await (await search('실패 검색')).json();

  test.mock.restoreAll();
  kakaoByQuery({ '이상 검색': [place('f2', '분식집')] });
  test.mock.method(llm, 'generateJson', async () => '검색어는 떡볶이입니다');
  const odd = await (await search('이상 검색')).json();

  assert.deepStrictEqual(failed.places.map((p) => p.name), ['한식당']);
  assert.deepStrictEqual(odd.places.map((p) => p.name), ['분식집']);
});

test('넓힌 검색어 하나로 카카오가 실패해도 나머지 결과는 쓴다', async () => {
  test.mock.method(kakao, 'searchPlaces', async (query) => {
    if (query === '부분 실패2') {
      throw new Error('카카오 API 응답이 500입니다.');
    }
    return query === '부분 실패1' ? [place('p1', '찾은가게')] : [];
  });
  test.mock.method(llm, 'generateJson', async () => '{"keywords":["부분 실패1","부분 실패2"]}');

  const res = await search('부분 실패');
  const body = await res.json();

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(body.places.map((p) => [p.name, p.via]), [['찾은가게', '부분 실패1']]);
});

test('원래 검색어로 카카오가 실패하면 넓히지 않고 502다', async () => {
  test.mock.method(kakao, 'searchPlaces', async () => {
    throw new Error('카카오 API 응답이 500입니다.');
  });
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"keywords":["무엇"]}');

  const res = await search('카카오 실패 넓히기');

  assert.strictEqual(res.status, 502);
  assert.strictEqual(fakeLlm.mock.callCount(), 0);
});

test('검색어가 50자를 넘으면 400이고 카카오와 LLM을 부르지 않는다', async () => {
  const fakeKakao = test.mock.method(kakao, 'searchPlaces', async () => []);
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"keywords":[]}');

  const res = await search('가'.repeat(51));
  const ok = await search('나'.repeat(50));

  assert.strictEqual(res.status, 400);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(fakeKakao.mock.callCount(), 1);
  assert.strictEqual(fakeLlm.mock.callCount(), 1);
});

test('사람별 LLM 한도에 걸린 검색어는 저장하지 않아서 다음에 다시 넓힐 수 있다', async () => {
  kakaoByQuery({ '한도 국물': [], '한도 국밥': [place('l1', '국밥집')] });
  let calls = 0;
  test.mock.method(llm, 'generateJson', async () => {
    calls += 1;
    if (calls === 1) {
      const err = new Error('LLM 사람별 한도를 넘었습니다.');
      err.code = 'LLM_LIMIT';
      throw err;
    }
    return '{"keywords":["한도 국밥"]}';
  });

  const first = await (await search('한도 국물')).json();
  const second = await (await search('한도 국물')).json();

  assert.deepStrictEqual(first.places, []);
  assert.deepStrictEqual(second.places.map((p) => p.name), ['국밥집']);
});

// 검색 결과 순서 (대표 메뉴 가게 먼저)

function shop(id, name, category) {
  return { id: id, name: name, lat: 37.62, lng: 127.06, category: category, address: '서울 노원구' };
}

// 가게가 10곳이 넘어야 검색어 넓히기를 건너뛴다. 순서만 보려고 채우는 가게들
function fillers(prefix, count) {
  return Array.from({ length: count }, (_, i) => shop(prefix + i, prefix + '집' + i, '음식점 > 한식'));
}

test('이름이나 분류에 검색어가 있는 가게가 LLM 없이도 위로 온다', async () => {
  kakaoByQuery({
    순서돈까스: [
      shop('r1', '김가네', '음식점 > 분식'),
      shop('r2', '윤스쿡', '음식점 > 일식 > 순서돈까스,우동'),
      shop('r3', '두찜', '음식점 > 한식 > 닭요리'),
      shop('r4', '순서돈까스 본점', '음식점 > 일식'),
      ...fillers('ra', 8),
    ],
  });
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('GEMINI_API_KEY가 없습니다.');
  });

  const body = await (await search('순서돈까스')).json();

  assert.deepStrictEqual(body.places.slice(0, 4).map((p) => [p.name, p.match]), [
    ['윤스쿡', 'main'],
    ['순서돈까스 본점', 'main'],
    ['김가네', undefined],
    ['두찜', undefined],
  ]);
  assert.strictEqual(body.places.length, 12);
});

test('규칙으로 못 정한 가게는 LLM이 정한 자리대로 대표, 곁들임, 팔지 않음 순서가 된다', async () => {
  kakaoByQuery({
    자리제육: [
      shop('s1', '이디야커피', '음식점 > 카페'),
      shop('s2', '김밥집', '음식점 > 분식'),
      shop('s3', '백반집', '음식점 > 한식'),
      shop('s4', '모르는집', '음식점'),
      ...fillers('sb', 8),
    ],
  });
  const fakeLlm = test.mock.method(llm, 'generateJson', async (prompt) => {
    assert.ok(prompt.includes('1. 이디야커피 (음식점 > 카페)'));
    return '{"main":[3],"side":[2],"none":[1]}';
  });

  const body = await (await search('자리제육')).json();

  assert.deepStrictEqual(body.places.slice(0, 2).map((p) => [p.name, p.match]), [
    ['백반집', 'main'],
    ['김밥집', 'side'],
  ]);
  assert.deepStrictEqual(body.places.slice(2, 4).map((p) => p.name), ['모르는집', 'sb집0']);
  assert.deepStrictEqual([body.places[11].name, body.places[11].match], ['이디야커피', 'none']);
  assert.strictEqual(rankCalls(fakeLlm), 1);
});

test('같은 검색어와 같은 가게 묶음이면 순서를 LLM에게 다시 묻지 않는다', async () => {
  kakaoByQuery({ 다시순서: [shop('c1', '가집', '음식점'), shop('c2', '나집', '음식점'), ...fillers('cc', 9)] });
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"main":[2]}');

  await search('다시순서');
  const body = await (await search('다시순서')).json();

  assert.strictEqual(rankCalls(fakeLlm), 1);
  assert.strictEqual(body.places[0].name, '나집');
});

test('순서를 묻는 LLM이 이상한 답을 주면 원래 순서 그대로다', async () => {
  kakaoByQuery({ 이상순서: [shop('o1', '가집', '음식점'), shop('o2', '나집', '음식점'), ...fillers('oc', 9)] });
  test.mock.method(llm, 'generateJson', async () => '2번이 대표 메뉴입니다');

  const body = await (await search('이상순서')).json();

  assert.deepStrictEqual(body.places.slice(0, 2).map((p) => [p.name, p.match]), [
    ['가집', undefined],
    ['나집', undefined],
  ]);
});

test('기록에 검색어가 적힌 가게는 대표 메뉴 가게보다도 위다', async () => {
  store.addPlace({ id: 'rk1', name: '기록집', lat: 37.62, lng: 127.06, category: '음식점 > 한식' });
  store.addReview({ placeId: 'rk1', text: '기록순서 메뉴가 맛있어요', price: 8000, tags: [], anonId: 'rank-test' });
  kakaoByQuery({ 기록순서: [shop('rk2', '기록순서 전문점', '음식점'), shop('rk1', '기록집', '음식점 > 한식'), ...fillers('rd', 9)] });
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"none":[1]}');

  const body = await (await search('기록순서')).json();

  assert.deepStrictEqual(body.places.slice(0, 2).map((p) => p.name), ['기록집', '기록순서 전문점']);
  // 기록으로 찾은 가게와 규칙으로 정한 가게는 LLM에게 묻지 않는다
  assert.ok(!fakeLlm.mock.calls[0].arguments[0].includes('기록집'));
});

test('가게가 한 곳이면 순서를 LLM에게 묻지 않는다', async () => {
  kakaoByQuery({ 한곳순서: [shop('h1', '혼자집', '음식점')] });
  const fakeLlm = test.mock.method(llm, 'generateJson', async () => '{"keywords":[]}');

  await search('한곳순서');

  assert.strictEqual(rankCalls(fakeLlm), 0);
});
