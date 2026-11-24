const test = require('node:test');
const assert = require('node:assert');

const {
  MAX_CANDIDATES,
  ROOM_CODE_CHARS,
  validateCandidates,
  makeRoomCode,
  normalizeRoomCode,
} = require('../shared/roomRules');

function place(id, name) {
  return { id: id, name: name || '가게' + id, lat: 37.62, lng: 127.058, category: '음식점 > 한식' };
}

// 후보 검사

test('후보 두 곳이면 통과하고 저장할 모양으로 바뀐다', () => {
  const result = validateCandidates([place(' 1 ', ' 윤스쿡 '), place('2')]);
  assert.deepStrictEqual(result, {
    ok: true,
    value: [
      { placeId: '1', name: '윤스쿡', lat: 37.62, lng: 127.058, category: '음식점 > 한식' },
      { placeId: '2', name: '가게2', lat: 37.62, lng: 127.058, category: '음식점 > 한식' },
    ],
  });
});

test('후보 순서가 그대로 유지된다 (R8 동점이면 먼저 오른 쪽)', () => {
  const result = validateCandidates([place('3'), place('1'), place('2')]);
  assert.deepStrictEqual(result.value.map((c) => c.placeId), ['3', '1', '2']);
});

test(`후보가 한 곳이거나 ${MAX_CANDIDATES}곳보다 많으면 안 된다`, () => {
  assert.strictEqual(validateCandidates([place('1')]).ok, false);

  const many = [];
  for (let i = 0; i < MAX_CANDIDATES + 1; i += 1) {
    many.push(place(String(i)));
  }
  assert.strictEqual(validateCandidates(many).ok, false);
  assert.strictEqual(validateCandidates(many.slice(0, MAX_CANDIDATES)).ok, true);
});

test('같은 가게를 두 번 넣으면 안 된다. 앞뒤 공백만 다른 것도 같은 가게다', () => {
  const result = validateCandidates([place('1'), place(' 1')]);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /두 번/);
});

test('후보 목록이 배열이 아니면 안 된다', () => {
  assert.strictEqual(validateCandidates(undefined).ok, false);
  assert.strictEqual(validateCandidates({ 0: place('1') }).ok, false);
});

test('가게 정보가 빠졌거나 모양이 틀린 후보가 있으면 안 된다', () => {
  assert.strictEqual(validateCandidates([place('1'), null]).ok, false);
  assert.strictEqual(validateCandidates([place('1'), { ...place('2'), id: '' }]).ok, false);
  assert.strictEqual(validateCandidates([place('1'), { ...place('2'), name: '  ' }]).ok, false);
  assert.strictEqual(validateCandidates([place('1'), { ...place('2'), lat: '37.62' }]).ok, false);
  assert.strictEqual(validateCandidates([place('1'), { ...place('2'), lng: NaN }]).ok, false);
  assert.strictEqual(validateCandidates([place('1'), { ...place('2'), category: null }]).ok, false);
  assert.strictEqual(validateCandidates([place('1'), { ...place('2'), id: 'x'.repeat(51) }]).ok, false);
});

// 방 코드

test('방 코드는 6자리이고 정해 둔 글자로만 만들어진다', () => {
  let n = 0;
  const code = makeRoomCode((max) => {
    n += 7;
    return n % max;
  });
  assert.strictEqual(code.length, 6);
  for (const char of code) {
    assert.ok(ROOM_CODE_CHARS.includes(char), `${char}는 쓰지 않는 글자`);
  }
});

test('방 코드에는 헷갈리는 0, O, 1, I가 없다', () => {
  for (const char of '0O1I') {
    assert.strictEqual(ROOM_CODE_CHARS.includes(char), false);
  }
});

test('난수 함수가 돌려준 값대로 글자를 고른다', () => {
  assert.strictEqual(makeRoomCode(() => 0), 'AAAAAA');
  assert.strictEqual(makeRoomCode((max) => max - 1), '999999');
});

test('입력한 방 코드는 공백을 지우고 대문자로 바꿔서 비교한다', () => {
  assert.strictEqual(normalizeRoomCode(' k7px2m '), 'K7PX2M');
});

test('길이가 다르거나 쓰지 않는 글자가 있으면 방 코드가 아니다', () => {
  assert.strictEqual(normalizeRoomCode('K7PX2'), null);
  assert.strictEqual(normalizeRoomCode('K7PX2MM'), null);
  assert.strictEqual(normalizeRoomCode('K7PX0M'), null);
  assert.strictEqual(normalizeRoomCode('K7-X2M'), null);
  assert.strictEqual(normalizeRoomCode(undefined), null);
});
