const test = require('node:test');
const assert = require('node:assert');

const {
  MAX_RECORD_PLACES,
  compact,
  reviewMatches,
  findPlacesByRecords,
  mergeResults,
} = require('../shared/recordSearch');

const places = [
  { id: '1', name: '윤스쿡', lat: 37.6203, lng: 127.0584, category: '음식점 > 일식 > 돈까스,우동' },
  { id: '2', name: '광운분식', lat: 37.62, lng: 127.059, category: '음식점 > 분식' },
  { id: '3', name: '국밥집', lat: 37.619, lng: 127.057, category: '음식점 > 한식 > 국밥' },
];

const reviews = [
  { placeId: '1', text: '제육 7천원인데 양 많음', createdAt: '2026-11-20T03:00:00.000Z' },
  { placeId: '2', text: '떡볶이 맵고 제육덮밥도 괜찮음', createdAt: '2026-11-21T03:00:00.000Z' },
  { placeId: '2', text: '제육 양 많아요', createdAt: '2026-11-19T03:00:00.000Z' },
  { placeId: '3', text: '순대국밥 든든함', createdAt: '2026-11-22T03:00:00.000Z' },
];

const ids = (list) => list.map((place) => place.id);

test('띄어쓰기를 지우고 영어는 소문자로 바꾼다', () => {
  assert.strictEqual(compact(' 제 육  덮밥 '), '제육덮밥');
  assert.strictEqual(compact('BBQ 치킨'), 'bbq치킨');
  assert.strictEqual(compact(undefined), '');
});

test('문장에 검색어가 있으면 맞는 기록이다. 띄어쓰기가 달라도 된다', () => {
  assert.strictEqual(reviewMatches(reviews[0], '제육'), true);
  assert.strictEqual(reviewMatches(reviews[0], '제 육'), true);
  assert.strictEqual(reviewMatches(reviews[0], '돈까스'), false);
});

test('먹은 메뉴 칸이 있으면 그 칸도 본다', () => {
  const review = { placeId: '1', text: '양 많고 빨리 나옴', menu: '제육볶음' };
  assert.strictEqual(reviewMatches(review, '제육'), true);
});

test('검색어가 비어 있으면 어떤 기록도 맞지 않는다', () => {
  assert.strictEqual(reviewMatches(reviews[0], '   '), false);
  assert.deepStrictEqual(findPlacesByRecords(places, reviews, ''), []);
});

test('검색어가 들어 있는 기록이 있는 가게를 찾고 fromRecords를 붙인다', () => {
  const result = findPlacesByRecords(places, reviews, '국밥');
  assert.deepStrictEqual(result, [
    {
      id: '3',
      name: '국밥집',
      lat: 37.619,
      lng: 127.057,
      category: '음식점 > 한식 > 국밥',
      address: '',
      fromRecords: true,
    },
  ]);
});

test('맞는 기록이 많은 가게가 앞에 온다', () => {
  // 광운분식은 제육 기록이 2개, 윤스쿡은 1개
  assert.deepStrictEqual(ids(findPlacesByRecords(places, reviews, '제육')), ['2', '1']);
});

test('맞는 기록 수가 같으면 최근 기록이 있는 가게가 앞에 온다', () => {
  const sameCount = [
    { placeId: '1', text: '김밥 맛있음', createdAt: '2026-11-20T03:00:00.000Z' },
    { placeId: '2', text: '김밥 싸다', createdAt: '2026-11-22T03:00:00.000Z' },
  ];
  assert.deepStrictEqual(ids(findPlacesByRecords(places, sameCount, '김밥')), ['2', '1']);
});

test('기록은 있는데 가게 목록에 없는 가게는 빼고, 잘못된 입력이면 빈 배열이다', () => {
  const orphan = [{ placeId: '999', text: '제육 맛집' }];
  assert.deepStrictEqual(findPlacesByRecords(places, orphan, '제육'), []);
  assert.deepStrictEqual(findPlacesByRecords(undefined, reviews, '제육'), []);
  assert.deepStrictEqual(findPlacesByRecords(places, null, '제육'), []);
});

test(`기록으로 찾은 가게는 ${MAX_RECORD_PLACES}개까지만 돌려준다`, () => {
  const many = [];
  const manyReviews = [];
  for (let i = 0; i < MAX_RECORD_PLACES + 5; i += 1) {
    many.push({ id: String(i), name: '가게' + i, lat: 37.62, lng: 127.06, category: '음식점' });
    manyReviews.push({ placeId: String(i), text: '라면 맛있음' });
  }
  assert.strictEqual(findPlacesByRecords(many, manyReviews, '라면').length, MAX_RECORD_PLACES);
});

test('기록으로 찾은 가게를 카카오 결과 앞에 붙이고 겹치는 가게는 한 번만 넣는다', () => {
  const recordPlaces = findPlacesByRecords(places, reviews, '제육');
  const kakaoPlaces = [
    { id: '7', name: '제육전문점', lat: 37.62, lng: 127.06, category: '음식점 > 한식', address: '서울 노원구 가' },
    { id: '1', name: '윤스쿡', lat: 37.6203, lng: 127.0584, category: '음식점 > 일식 > 돈까스,우동', address: '서울 노원구 광운로' },
  ];

  const merged = mergeResults(recordPlaces, kakaoPlaces);

  assert.deepStrictEqual(ids(merged), ['2', '1', '7']);
  // 겹친 가게는 카카오의 주소를 쓰고 fromRecords를 붙인다
  assert.strictEqual(merged[1].address, '서울 노원구 광운로');
  assert.strictEqual(merged[1].fromRecords, true);
  // 카카오에만 있는 가게는 그대로
  assert.strictEqual(merged[2].fromRecords, undefined);
});

test('기록으로 찾은 가게가 없으면 카카오 결과가 그대로다', () => {
  const kakaoPlaces = [{ id: '7', name: '제육전문점', address: '서울' }];
  assert.deepStrictEqual(mergeResults([], kakaoPlaces), kakaoPlaces);
  assert.deepStrictEqual(mergeResults([], []), []);
});

test('신고로 숨긴 한 줄 추천은 찾지 않는다', () => {
  const hidden = { placeId: '1', text: '제육 맛집', hidden: true };
  assert.strictEqual(reviewMatches(hidden, '제육'), false);
  assert.deepStrictEqual(findPlacesByRecords(places, [hidden], '제육'), []);
});
