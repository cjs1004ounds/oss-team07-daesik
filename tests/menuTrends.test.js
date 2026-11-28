const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TREND_DAYS,
  MAX_TRENDS,
  BATCH_SIZE,
  buildMenuPrompt,
  parseMenus,
  recentReviews,
  reviewsToExtract,
  trendingMenus,
  TIME_SLOTS,
  MIN_SLOT_MENUS,
  koreaHour,
  slotOf,
  slotMenus,
} = require('../shared/menuTrends');

const NOW = Date.parse('2026-11-25T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function review(id, days, extra = {}) {
  return { id: id, placeId: 'p1', text: '글 ' + id, createdAt: daysAgo(days), ...extra };
}

// 함수

test('문장에 추천마다 id가 붙고 <추천> 블록 안에 들어간다', () => {
  const prompt = buildMenuPrompt([{ id: 'r1', text: '제육 양 많음' }, { id: 'r2', text: '아아\n시원함' }]);
  assert.ok(prompt.includes('<추천>\nr1: 제육 양 많음\nr2: 아아 시원함\n</추천>'));
  assert.ok(prompt.includes('지어내지 않는다'));
});

test('id별 메뉴를 꺼내고, 보낸 id는 메뉴가 없어도 빈 목록으로 넣는다', () => {
  const result = parseMenus('{"menus":{"r1":["제육볶음"],"r9":["모르는 id"]}}', ['r1', 'r2']);
  assert.deepStrictEqual(result, { ok: true, value: { r1: ['제육볶음'], r2: [] } });
});

test('겹치는 메뉴, 너무 긴 이름, 특수문자가 섞인 이름은 빼고 3개까지만 받는다', () => {
  const result = parseMenus(
    JSON.stringify({ menus: { r1: ['제육볶음', '제육 볶음', '가'.repeat(16), '<b>국밥</b>', '김치찌개', '된장찌개', '계란말이'] } }),
    ['r1']
  );
  assert.deepStrictEqual(result.value.r1, ['제육볶음', '김치찌개', '된장찌개']);
});

test('JSON이 아니거나 목록 모양이 아니면 버린다', () => {
  assert.strictEqual(parseMenus('제육볶음', ['r1']).ok, false);
  assert.strictEqual(parseMenus('{"menus":["제육볶음"]}', ['r1']).ok, false);
  assert.strictEqual(parseMenus('', ['r1']).ok, false);
});

test(`최근 ${TREND_DAYS}일 안의 숨기지 않은 추천만 본다`, () => {
  const list = recentReviews([review('a', 1), review('b', TREND_DAYS), review('c', 2, { hidden: true }), review('d', -1)], NOW);
  assert.deepStrictEqual(list.map((r) => r.id), ['a']);
});

test(`아직 뽑지 않은 추천만 ${BATCH_SIZE}개까지 고른다`, () => {
  const many = Array.from({ length: 25 }, (_, i) => review('r' + i, 1));
  many[0].menusCheckedAt = daysAgo(0);
  const pending = reviewsToExtract(many, NOW);
  assert.strictEqual(pending.length, BATCH_SIZE);
  assert.strictEqual(pending.some((r) => r.id === 'r0'), false);
});

test('메뉴마다 나온 추천 수를 세고 많은 순으로, 띄어쓰기만 다른 이름은 같은 메뉴로 센다', () => {
  const reviews = [
    review('a', 1, { menus: ['제육볶음'], placeId: 'p1' }),
    review('b', 2, { menus: ['제육 볶음', '김치찌개'], placeId: 'p2' }),
    review('c', 3, { menus: ['김치찌개'], placeId: 'p1' }),
    review('d', 1, { menus: ['제육볶음'], placeId: 'p1' }),
  ];
  const places = [{ id: 'p1', name: '윤스쿡' }, { id: 'p2', name: '한식밥상' }];

  assert.deepStrictEqual(trendingMenus(reviews, places, NOW), [
    { name: '제육볶음', count: 3, places: [{ id: 'p1', name: '윤스쿡' }, { id: 'p2', name: '한식밥상' }] },
    { name: '김치찌개', count: 2, places: [{ id: 'p2', name: '한식밥상' }, { id: 'p1', name: '윤스쿡' }] },
  ]);
});

test('수가 같으면 최근에 나온 메뉴가 앞이다', () => {
  const reviews = [review('a', 5, { menus: ['국밥'] }), review('b', 1, { menus: ['라멘'] })];
  assert.deepStrictEqual(trendingMenus(reviews, [], NOW).map((m) => m.name), ['라멘', '국밥']);
});

test('사용자가 적은 먹은 메뉴 칸(menu)도 같이 세고, 한 추천에서 같은 메뉴는 한 번만 센다', () => {
  const reviews = [review('a', 1, { menus: ['돈까스'], menu: '돈까스' }), review('b', 1, { menu: '돈까스' })];
  assert.strictEqual(trendingMenus(reviews, [], NOW)[0].count, 2);
});

test(`${MAX_TRENDS}개까지만 돌려주고, 기록이 없으면 빈 목록이다`, () => {
  const reviews = Array.from({ length: 12 }, (_, i) => review('r' + i, 1, { menus: ['메뉴' + i] }));
  assert.strictEqual(trendingMenus(reviews, [], NOW).length, MAX_TRENDS);
  assert.deepStrictEqual(trendingMenus([], [], NOW), []);
  assert.deepStrictEqual(trendingMenus(undefined, undefined, NOW), []);
});

// 시간대

// 한국 시간으로 며칠 전 몇 시에 쓴 추천. NOW는 한국 시간 낮 12시다
function reviewAt(id, days, hour, extra = {}) {
  const createdAt = new Date(NOW - days * DAY_MS + (hour - 12) * 60 * 60 * 1000).toISOString();
  return { id: id, placeId: 'p1', text: '글 ' + id, createdAt: createdAt, ...extra };
}

// 한국 시간으로 오늘 몇 시인지를 ms로
function todayAt(hour) {
  return NOW + (hour - 12) * 60 * 60 * 1000;
}

test('한국 시간으로 몇 시인지 알아낸다', () => {
  assert.strictEqual(koreaHour('2026-11-25T03:00:00.000Z'), 12);
  assert.strictEqual(koreaHour('2026-11-25T15:30:00.000Z'), 0);
  assert.strictEqual(koreaHour(Date.parse('2026-11-25T14:59:59.000Z')), 23);
  assert.strictEqual(koreaHour('시각 아님'), -1);
  assert.strictEqual(koreaHour(undefined), -1);
});

test('하루의 모든 시각이 시간대 하나에 들어간다', () => {
  const expected = { 0: '밤', 5: '밤', 6: '아침', 10: '아침', 11: '점심', 13: '점심', 14: '점심', 15: '오후', 16: '오후', 17: '저녁', 18: '저녁', 20: '저녁', 21: '밤', 23: '밤' };
  for (const [hour, label] of Object.entries(expected)) {
    assert.strictEqual(slotOf(todayAt(Number(hour))).label, label, hour + '시');
  }
  for (let hour = 0; hour < 24; hour += 1) {
    assert.ok(TIME_SLOTS.includes(slotOf(todayAt(hour))), hour + '시');
  }
  assert.strictEqual(slotOf('시각 아님'), null);
});

test('같은 기록이어도 점심과 저녁에 다른 순위가 나온다', () => {
  const reviews = [
    reviewAt('l1', 1, 12, { menu: '돈까스' }),
    reviewAt('l2', 2, 13, { menu: '돈까스' }),
    reviewAt('l3', 3, 11, { menu: '제육볶음' }),
    reviewAt('l4', 4, 14, { menu: '김치찌개' }),
    reviewAt('d1', 1, 18, { menu: '치킨' }),
    reviewAt('d2', 2, 19, { menu: '치킨' }),
    reviewAt('d3', 3, 17, { menu: '피자' }),
    reviewAt('d4', 4, 20, { menu: '제육볶음' }),
  ];

  const lunch = slotMenus(reviews, [], todayAt(13));
  assert.deepStrictEqual(lunch.slot, { key: 'lunch', label: '점심' });
  assert.deepStrictEqual(lunch.menus.map((m) => [m.name, m.count]), [['돈까스', 2], ['제육볶음', 1], ['김치찌개', 1]]);

  const dinner = slotMenus(reviews, [], todayAt(18));
  assert.deepStrictEqual(dinner.slot, { key: 'dinner', label: '저녁' });
  assert.deepStrictEqual(dinner.menus.map((m) => [m.name, m.count]), [['치킨', 2], ['피자', 1], ['제육볶음', 1]]);
});

test(`지금 시간대의 메뉴가 ${MIN_SLOT_MENUS}개보다 적으면 시간대를 나누지 않은 것을 돌려준다`, () => {
  const reviews = [
    reviewAt('l1', 1, 12, { menu: '돈까스' }),
    reviewAt('l2', 2, 13, { menu: '제육볶음' }),
    reviewAt('l3', 3, 12, { menu: '김치찌개' }),
    reviewAt('d1', 1, 18, { menu: '치킨' }),
    reviewAt('d2', 2, 19, { menu: '피자' }),
  ];
  const now = todayAt(18);

  const dinner = slotMenus(reviews, [], now);
  assert.strictEqual(dinner.slot, null);
  assert.deepStrictEqual(dinner.menus, trendingMenus(reviews, [], now));
  assert.strictEqual(dinner.menus.length, 5);

  assert.deepStrictEqual(slotMenus([], [], now), { slot: null, menus: [] });
  assert.deepStrictEqual(slotMenus(undefined, undefined, now), { slot: null, menus: [] });
});

test('자정을 넘는 밤 시간대는 밤 9시와 새벽 2시의 기록을 같이 센다', () => {
  const reviews = [
    reviewAt('n1', 1, 22, { menu: '치킨' }),
    reviewAt('n2', 2, 2, { menu: '라면' }),
    reviewAt('n3', 3, 23, { menu: '떡볶이' }),
    reviewAt('l1', 1, 12, { menu: '돈까스' }),
  ];
  const night = slotMenus(reviews, [], todayAt(21) + 30 * 60 * 1000);
  assert.strictEqual(night.slot.key, 'night');
  assert.deepStrictEqual(night.menus.map((m) => m.name).sort(), ['떡볶이', '라면', '치킨']);
});

test('시간대로 셀 때도 숨긴 추천과 14일이 지난 추천은 세지 않고, 가게 이름을 붙인다', () => {
  const places = [{ id: 'p1', name: '광운식당' }];
  const reviews = [
    reviewAt('a', 1, 12, { menu: '돈까스' }),
    reviewAt('b', 2, 12, { menu: '제육볶음' }),
    reviewAt('c', 3, 12, { menu: '김치찌개' }),
    reviewAt('d', 1, 12, { menu: '숨긴메뉴', hidden: true }),
    reviewAt('e', TREND_DAYS + 1, 12, { menu: '오래된메뉴' }),
  ];
  const lunch = slotMenus(reviews, places, todayAt(13));
  assert.deepStrictEqual(lunch.menus.map((m) => m.name), ['돈까스', '제육볶음', '김치찌개']);
  assert.deepStrictEqual(lunch.menus[0].places, [{ id: 'p1', name: '광운식당' }]);
});

// API

const app = require('../server/app');
const store = require('../server/store');
const llm = require('../server/llm');

let server;
let baseUrl;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-trends-test-'));
  process.env.DATA_DIR = path.join(dataDir, 'runtime');
  process.env.SEED_DIR = path.join(dataDir, 'seed');
  store.load();
  store.addPlace({ id: 'yoon', name: '윤스쿡', lat: 37.62, lng: 127.058, category: '음식점 > 일식' });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test.afterEach(() => {
  test.mock.restoreAll();
});

async function getTrends() {
  return (await fetch(`${baseUrl}/api/trends`)).json();
}

test('LLM으로 새 추천의 메뉴를 뽑아 세고, 다음에는 다시 묻지 않는다', async () => {
  const r1 = store.addReview({ placeId: 'yoon', text: '제육 7천원인데 양 많음', price: 7000, tags: [], anonId: 'a' });
  const r2 = store.addReview({ placeId: 'yoon', text: '제육덮밥 맛있음 돈까스도 괜찮음', price: null, tags: [], anonId: 'b' });
  const fake = test.mock.method(llm, 'generateJson', async () =>
    JSON.stringify({ menus: { [r1.id]: ['제육볶음'], [r2.id]: ['제육볶음', '돈까스'] } })
  );

  const first = await getTrends();
  const second = await getTrends();

  assert.strictEqual(first.days, 14);
  // 메뉴가 2개뿐이라 시간대를 나누지 않는다
  assert.strictEqual(first.slot, null);
  assert.deepStrictEqual(first.menus.map((m) => [m.name, m.count]), [['제육볶음', 2], ['돈까스', 1]]);
  assert.deepStrictEqual(first.menus[0].places, [{ id: 'yoon', name: '윤스쿡' }]);
  assert.deepStrictEqual(second.menus, first.menus);
  assert.strictEqual(fake.mock.callCount(), 1);
  assert.strictEqual(typeof store.getReview(r1.id).menusCheckedAt, 'string');
});

test('LLM이 실패하면 이미 뽑아 둔 것으로만 세고, 다음에 다시 뽑는다', async () => {
  const r3 = store.addReview({ placeId: 'yoon', text: '라멘 국물 진함', price: null, tags: [], anonId: 'c' });
  test.mock.method(llm, 'generateJson', async () => {
    throw new Error('Gemini 호출 실패 (500)');
  });
  const failed = await getTrends();

  test.mock.restoreAll();
  test.mock.method(llm, 'generateJson', async () => JSON.stringify({ menus: { [r3.id]: ['라멘'] } }));
  const later = await getTrends();

  assert.deepStrictEqual(failed.menus.map((m) => m.name), ['제육볶음', '돈까스']);
  assert.ok(later.menus.some((m) => m.name === '라멘'));
});

test('지금 시간대에 쓴 메뉴가 충분하면 slot에 지금 시간대가 오고 그 메뉴만 센다', async () => {
  // 앞의 테스트에서 방금 쓴 추천으로 제육볶음, 돈까스, 라멘이 있다
  test.mock.method(llm, 'generateJson', async () => '{"menus":{}}');
  const now = slotOf(Date.now());
  const body = await getTrends();

  assert.deepStrictEqual(body.slot, { key: now.key, label: now.label });
  assert.deepStrictEqual(body.menus.map((m) => m.name).sort(), ['돈까스', '라멘', '제육볶음']);
});

test('새 추천이 없으면 LLM을 부르지 않는다', async () => {
  const fake = test.mock.method(llm, 'generateJson', async () => '{"menus":{}}');
  await getTrends();
  assert.strictEqual(fake.mock.callCount(), 0);
});
