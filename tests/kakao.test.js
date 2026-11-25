const test = require('node:test');
const assert = require('node:assert');

const kakao = require('../server/kakao');

// 실제 카카오 API는 부르지 않는다.
// fetch를 가짜 함수로 바꿔 놓고, 어떤 주소로 요청하는지만 본다
const savedKey = process.env.KAKAO_REST_API_KEY;

test.afterEach(() => {
  test.mock.restoreAll();
  if (savedKey === undefined) {
    delete process.env.KAKAO_REST_API_KEY;
  } else {
    process.env.KAKAO_REST_API_KEY = savedKey;
  }
});

// 카카오가 결과 없이 정상 응답한 것처럼 꾸민다
function mockFetch() {
  return test.mock.method(global, 'fetch', async () => ({
    ok: true,
    json: async () => ({ documents: [] }),
  }));
}

test('검색 가운데는 광운대학교이고 반경은 도보 15분에 맞춘 1km다', () => {
  assert.deepStrictEqual(kakao.SEARCH_CENTER, { lat: 37.61924, lng: 127.05827 });
  assert.strictEqual(kakao.SEARCH_RADIUS_M, 1000);
});

test('카카오에 가운데 좌표, 반경, 음식점 분류를 붙여서 요청한다', async () => {
  process.env.KAKAO_REST_API_KEY = 'test-rest-key';
  const fake = mockFetch();

  await kakao.searchPlaces('제육');

  const url = new URL(fake.mock.calls[0].arguments[0]);
  assert.strictEqual(url.origin + url.pathname, 'https://dapi.kakao.com/v2/local/search/keyword.json');
  assert.strictEqual(url.searchParams.get('query'), '제육');
  assert.strictEqual(url.searchParams.get('y'), '37.61924');
  assert.strictEqual(url.searchParams.get('x'), '127.05827');
  assert.strictEqual(url.searchParams.get('radius'), '1000');
  assert.strictEqual(url.searchParams.get('category_group_code'), 'FD6');
});

test('REST 키는 주소가 아니라 Authorization 헤더에 넣는다', async () => {
  process.env.KAKAO_REST_API_KEY = 'test-rest-key';
  const fake = mockFetch();

  await kakao.searchPlaces('제육');

  const [url, options] = fake.mock.calls[0].arguments;
  assert.strictEqual(options.headers.Authorization, 'KakaoAK test-rest-key');
  assert.ok(!String(url).includes('test-rest-key'));
});

test('키가 없으면 카카오를 부르지 않고 오류를 던진다', async () => {
  delete process.env.KAKAO_REST_API_KEY;
  const fake = mockFetch();

  await assert.rejects(() => kakao.searchPlaces('제육'));
  assert.strictEqual(fake.mock.callCount(), 0);
});

test('카카오가 오류 상태로 응답하면 오류를 던진다', async () => {
  process.env.KAKAO_REST_API_KEY = 'test-rest-key';
  test.mock.method(global, 'fetch', async () => ({ ok: false, status: 403 }));

  await assert.rejects(() => kakao.searchPlaces('제육'));
});

// 음식점(FD6)과 카페(CE7)를 같이 찾는다

function kakaoDocument(id, name, distance, code) {
  return {
    id: id,
    place_name: name,
    x: '127.06',
    y: '37.62',
    category_name: code === 'CE7' ? '음식점 > 카페' : '음식점 > 한식',
    road_address_name: '서울 노원구',
    address_name: '',
    distance: distance,
  };
}

// 분류마다 다른 결과를 주는 가짜 카카오
function mockFetchByCategory(byCategory) {
  return test.mock.method(global, 'fetch', async (url) => {
    const code = new URL(url).searchParams.get('category_group_code');
    return { ok: true, json: async () => ({ documents: byCategory[code] || [] }) };
  });
}

test('음식점과 카페 분류로 한 번씩 찾는다', async () => {
  process.env.KAKAO_REST_API_KEY = 'test-rest-key';
  const fake = mockFetch();

  await kakao.searchPlaces('카페');

  const codes = fake.mock.calls.map((call) => new URL(call.arguments[0]).searchParams.get('category_group_code'));
  assert.deepStrictEqual(codes.sort(), ['CE7', 'FD6']);
});

test('두 분류의 결과를 학교에서 가까운 순으로 합친다', async () => {
  process.env.KAKAO_REST_API_KEY = 'test-rest-key';
  mockFetchByCategory({
    FD6: [kakaoDocument('1', '먼식당', '500', 'FD6'), kakaoDocument('2', '가까운식당', '100', 'FD6')],
    CE7: [kakaoDocument('3', '중간카페', '300', 'CE7'), kakaoDocument('4', '거리모름카페', '', 'CE7')],
  });

  const places = await kakao.searchPlaces('카페');

  assert.deepStrictEqual(places.map((p) => p.name), ['가까운식당', '중간카페', '먼식당', '거리모름카페']);
  assert.strictEqual(places[0].distance, undefined);
});

test('두 분류에 같은 가게가 있으면 한 번만 넣는다', async () => {
  process.env.KAKAO_REST_API_KEY = 'test-rest-key';
  mockFetchByCategory({
    FD6: [kakaoDocument('1', '디저트식당', '100', 'FD6')],
    CE7: [kakaoDocument('1', '디저트식당', '100', 'CE7')],
  });

  const places = await kakao.searchPlaces('디저트');
  assert.strictEqual(places.length, 1);
});

test(`합친 결과는 ${kakao.MAX_RESULTS}곳까지만 돌려준다`, async () => {
  process.env.KAKAO_REST_API_KEY = 'test-rest-key';
  const many = (code, start) => Array.from({ length: 15 }, (_, i) => kakaoDocument(String(start + i), '가게' + (start + i), String(i * 10), code));
  mockFetchByCategory({ FD6: many('FD6', 0), CE7: many('CE7', 100) });

  const places = await kakao.searchPlaces('밥');
  assert.strictEqual(places.length, kakao.MAX_RESULTS);
});

test('두 분류 중 하나라도 실패하면 오류를 던진다', async () => {
  process.env.KAKAO_REST_API_KEY = 'test-rest-key';
  test.mock.method(global, 'fetch', async (url) => {
    const code = new URL(url).searchParams.get('category_group_code');
    return code === 'CE7'
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, json: async () => ({ documents: [] }) };
  });

  await assert.rejects(() => kakao.searchPlaces('카페'), /500/);
});
