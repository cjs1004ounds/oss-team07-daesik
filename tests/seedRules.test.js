const test = require('node:test');
const assert = require('node:assert');

const { seedDate, seedAnonId, validateItem, findDuplicates, choosePlace, buildSeed } = require('../scripts/seedRules');

// 2026-11-26 낮 12시(한국 시간)를 지금으로 둔다
const NOW = Date.parse('2026-11-26T03:00:00.000Z');

function item(extra) {
  return {
    place: '윤스쿡',
    text: '제육이 맛있고 양이 많아요',
    menu: '제육볶음',
    price: 8000,
    tags: ['양 많음'],
    again: true,
    date: '2026-11-20',
    writer: 'A',
    ...extra,
  };
}

function kakaoPlace(id, name) {
  return { id: id, name: name, lat: 37.62, lng: 127.058, category: '음식점 > 한식', address: '서울 노원구 광운로' };
}

test('날짜는 그날 한국 시간 낮 12시로 바뀐다', () => {
  assert.strictEqual(seedDate('2026-11-20', NOW), '2026-11-20T03:00:00.000Z');
});

test('모양이 다르거나 없는 날짜, 오늘보다 뒤의 날짜는 받지 않는다', () => {
  assert.strictEqual(seedDate('2026/11/20', NOW), null);
  assert.strictEqual(seedDate('2026-02-30', NOW), null);
  assert.strictEqual(seedDate('2026-11-27', NOW), null);
  assert.strictEqual(seedDate(20261120, NOW), null);
});

test('같은 이름표는 같은 익명 ID가 되고, 이름표가 ID에 그대로 들어가지 않는다', () => {
  assert.strictEqual(seedAnonId('우영'), seedAnonId(' 우영 '));
  assert.notStrictEqual(seedAnonId('우영'), seedAnonId('지완'));
  assert.match(seedAnonId('우영'), /^seed-[0-9a-f]{12}$/);
});

test('올바른 입력은 검사한 값으로 바뀐다', () => {
  assert.deepStrictEqual(validateItem(item(), 1, NOW), {
    ok: true,
    value: {
      place: '윤스쿡',
      placeId: null,
      text: '제육이 맛있고 양이 많아요',
      price: 8000,
      tags: ['양 많음'],
      menu: '제육볶음',
      again: true,
      createdAt: '2026-11-20T03:00:00.000Z',
      writer: 'A',
    },
  });
});

test('한 줄 추천 없이 다녀왔어요만 적을 수 있다', () => {
  const result = validateItem({ place: '윤스쿡', again: false, date: '2026-11-20', writer: 'B' }, 1, NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.text, null);
  assert.strictEqual(result.value.again, false);
});

test('한 줄 추천도 다녀왔어요도 없으면 틀린 입력이고, 몇 번째인지 알려 준다', () => {
  const result = validateItem({ place: '윤스쿡', date: '2026-11-20', writer: 'B' }, 3, NOW);
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.startsWith('3번째: '));
});

test('한 줄 추천은 R6 검사를 그대로 받는다', () => {
  assert.strictEqual(validateItem(item({ text: '짧음' }), 1, NOW).ok, false);
  assert.strictEqual(validateItem(item({ price: 500 }), 1, NOW).ok, false);
  assert.strictEqual(validateItem(item({ tags: ['없는 태그'] }), 1, NOW).ok, false);
  assert.strictEqual(validateItem(item({ menu: '가'.repeat(21) }), 1, NOW).ok, false);
});

test('가게 이름, 쓴 사람, 날짜, 또 갈래요 값이 틀리면 받지 않는다', () => {
  assert.strictEqual(validateItem(item({ place: '  ' }), 1, NOW).ok, false);
  assert.strictEqual(validateItem(item({ writer: '' }), 1, NOW).ok, false);
  assert.strictEqual(validateItem(item({ date: '어제' }), 1, NOW).ok, false);
  assert.strictEqual(validateItem(item({ again: '네' }), 1, NOW).ok, false);
  assert.strictEqual(validateItem(null, 1, NOW).ok, false);
});

test('같은 사람이 같은 가게에 같은 날 두 번 적으면 겹친 줄을 알려 준다', () => {
  const items = [item(), item({ place: '윤 스쿡' }), item({ writer: 'B' }), item({ date: '2026-11-21' })].map(
    (one, index) => validateItem(one, index + 1, NOW).value
  );
  const errors = findDuplicates(items);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].startsWith('2번째: 1번째와'));
});

test('이름이 똑같은 가게를 고른다. 띄어쓰기는 무시한다', () => {
  const result = choosePlace('윤 스쿡', null, [kakaoPlace('1', '윤스쿡 2호점'), kakaoPlace('2', '윤스쿡')]);
  assert.strictEqual(result.place.id, '2');
});

test('똑같은 이름이 없어도 후보가 하나이고 이름이 들어 있으면 그 가게다', () => {
  const result = choosePlace('쉐프밥버거', null, [kakaoPlace('7', '쉐프밥버거 광운대점')]);
  assert.strictEqual(result.place.id, '7');
});

test('후보가 여럿이라 못 정하면 placeId를 적으라고 후보를 보여 준다', () => {
  const result = choosePlace('김가네', null, [kakaoPlace('3', '김가네 광운대점'), kakaoPlace('4', '김가네 월계점')]);
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('placeId 3'));
  assert.ok(result.error.includes('placeId 4'));
});

test('placeId를 적으면 그 번호의 가게를 고르고, 없는 번호면 틀린 입력이다', () => {
  const candidates = [kakaoPlace('3', '김가네 광운대점'), kakaoPlace('4', '김가네 월계점')];
  assert.strictEqual(choosePlace('김가네', '4', candidates).place.name, '김가네 월계점');
  assert.strictEqual(choosePlace('김가네', '9', candidates).ok, false);
});

test('검색 결과가 없으면 못 찾았다고 알려 준다', () => {
  assert.strictEqual(choosePlace('없는가게', null, []).ok, false);
});

test('시드 파일 세 개의 내용을 만든다. 가게는 한 번만 넣고 주소는 넣지 않는다', () => {
  const items = [
    item(),
    item({ writer: 'B', text: undefined, again: false }),
    item({ writer: 'C', again: undefined, date: '2026-11-21' }),
  ].map((one, index) => validateItem(one, index + 1, NOW).value);

  const seed = buildSeed(items, () => kakaoPlace('2', '윤스쿡'));

  assert.deepStrictEqual(seed.places, [{ id: '2', name: '윤스쿡', lat: 37.62, lng: 127.058, category: '음식점 > 한식' }]);
  assert.deepStrictEqual(seed.reviews.map((r) => [r.id, r.placeId, r.menu, r.verified, r.createdAt]), [
    ['seed-review-1', '2', '제육볶음', true, '2026-11-20T03:00:00.000Z'],
    ['seed-review-2', '2', '제육볶음', true, '2026-11-21T03:00:00.000Z'],
  ]);
  assert.deepStrictEqual(seed.visits.map((v) => [v.id, v.again, v.verified, v.roomCode]), [
    ['seed-visit-1', true, true, null],
    ['seed-visit-2', false, true, null],
  ]);
  // 같은 사람의 한 줄 추천과 다녀왔어요는 같은 익명 ID를 쓴다
  assert.strictEqual(seed.reviews[0].anonId, seed.visits[0].anonId);
  assert.notStrictEqual(seed.visits[0].anonId, seed.visits[1].anonId);
});
