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
