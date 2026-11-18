const test = require('node:test');
const assert = require('node:assert');

const { toKoreaDate, isDuplicateToday } = require('../shared/duplicateLimit');

// 시각은 전부 UTC로 적는다. 한국 시간은 여기에 9시간을 더한 값이다.
// 예: 2026-11-19T15:00:00Z 는 한국 시간으로 11월 20일 0시

// 한국 시간 11월 19일 낮 12시에 남긴 기록
const record = {
  anonId: 'anon-1',
  placeId: '100',
  createdAt: '2026-11-19T03:00:00.000Z',
};

// 한국 날짜로 바꾸기

test('UTC 시각을 한국 날짜로 바꾼다', () => {
  assert.strictEqual(toKoreaDate('2026-11-19T03:00:00.000Z'), '2026-11-19');
});

test('UTC로는 아직 19일이어도 한국 시간으로 자정이 지났으면 20일이다', () => {
  assert.strictEqual(toKoreaDate('2026-11-19T14:59:59.999Z'), '2026-11-19');
  assert.strictEqual(toKoreaDate('2026-11-19T15:00:00.000Z'), '2026-11-20');
});

test('달과 해가 넘어가는 경우도 맞게 바꾼다', () => {
  assert.strictEqual(toKoreaDate('2026-11-30T15:00:00.000Z'), '2026-12-01');
  assert.strictEqual(toKoreaDate('2026-12-31T15:00:00.000Z'), '2027-01-01');
});

test('Date와 밀리초 숫자도 받는다', () => {
  const date = new Date('2026-11-19T03:00:00.000Z');
  assert.strictEqual(toKoreaDate(date), '2026-11-19');
  assert.strictEqual(toKoreaDate(date.getTime()), '2026-11-19');
});

test('시각으로 읽을 수 없으면 null이다', () => {
  assert.strictEqual(toKoreaDate('시각 아님'), null);
  assert.strictEqual(toKoreaDate(undefined), null);
  assert.strictEqual(toKoreaDate({}), null);
});

// 하루 한 번 제한: 정상

test('같은 사람이 같은 가게에 같은 날 다시 남기면 중복이다', () => {
  const now = '2026-11-19T09:00:00.000Z'; // 한국 시간 19일 18시
  assert.strictEqual(isDuplicateToday([record], 'anon-1', '100', now), true);
});

test('다른 사람이면 중복이 아니다', () => {
  const now = '2026-11-19T09:00:00.000Z';
  assert.strictEqual(isDuplicateToday([record], 'anon-2', '100', now), false);
});

test('같은 사람이어도 다른 가게면 중복이 아니다', () => {
  const now = '2026-11-19T09:00:00.000Z';
  assert.strictEqual(isDuplicateToday([record], 'anon-1', '200', now), false);
});

test('기록이 하나도 없으면 중복이 아니다', () => {
  assert.strictEqual(isDuplicateToday([], 'anon-1', '100', '2026-11-19T09:00:00.000Z'), false);
});

test('여러 기록 중 하나라도 조건에 맞으면 중복이다', () => {
  const records = [
    { anonId: 'anon-2', placeId: '100', createdAt: '2026-11-19T01:00:00.000Z' },
    { anonId: 'anon-1', placeId: '200', createdAt: '2026-11-19T02:00:00.000Z' },
    record,
  ];
  assert.strictEqual(isDuplicateToday(records, 'anon-1', '100', '2026-11-19T09:00:00.000Z'), true);
});

// 하루 한 번 제한: 경계값 (한국 시간 자정 앞뒤)

test('한국 시간 23시 59분 59초에 남긴 뒤 0시에 다시 남기는 것은 다른 날이라 된다', () => {
  const lateNight = { ...record, createdAt: '2026-11-19T14:59:59.000Z' }; // 한국 시간 19일 23:59:59
  const now = '2026-11-19T15:00:00.000Z'; // 한국 시간 20일 00:00:00
  assert.strictEqual(isDuplicateToday([lateNight], 'anon-1', '100', now), false);
});

test('한국 시간 0시에 남긴 뒤 같은 날 23시 59분에 다시 남기는 것은 중복이다', () => {
  const midnight = { ...record, createdAt: '2026-11-19T15:00:00.000Z' }; // 한국 시간 20일 00:00:00
  const now = '2026-11-20T14:59:59.000Z'; // 한국 시간 20일 23:59:59. UTC 날짜는 다르다
  assert.strictEqual(isDuplicateToday([midnight], 'anon-1', '100', now), true);
});

test('UTC 날짜가 같아도 한국 날짜가 다르면 중복이 아니다', () => {
  const evening = { ...record, createdAt: '2026-11-19T10:00:00.000Z' }; // 한국 시간 19일 19시
  const now = '2026-11-19T16:00:00.000Z'; // 한국 시간 20일 01시
  assert.strictEqual(isDuplicateToday([evening], 'anon-1', '100', now), false);
});

test('어제 남긴 기록은 중복이 아니다', () => {
  const now = '2026-11-20T03:00:00.000Z'; // 정확히 24시간 뒤
  assert.strictEqual(isDuplicateToday([record], 'anon-1', '100', now), false);
});

// 하루 한 번 제한: 잘못된 입력

test('목록이 배열이 아니면 중복이 아닌 것으로 본다', () => {
  const now = '2026-11-19T09:00:00.000Z';
  assert.strictEqual(isDuplicateToday(null, 'anon-1', '100', now), false);
  assert.strictEqual(isDuplicateToday(undefined, 'anon-1', '100', now), false);
  assert.strictEqual(isDuplicateToday('기록', 'anon-1', '100', now), false);
});

test('지금 시각을 읽을 수 없으면 중복이 아닌 것으로 본다', () => {
  assert.strictEqual(isDuplicateToday([record], 'anon-1', '100', '시각 아님'), false);
});

test('시각이 깨진 기록이나 빈 칸이 섞여 있어도 나머지로 판단한다', () => {
  const now = '2026-11-19T09:00:00.000Z';
  const broken = { anonId: 'anon-1', placeId: '100', createdAt: '시각 아님' };

  assert.strictEqual(isDuplicateToday([broken, null], 'anon-1', '100', now), false);
  assert.strictEqual(isDuplicateToday([broken, null, record], 'anon-1', '100', now), true);
});

test('가게 id가 숫자와 문자열로 다르면 다른 가게로 본다', () => {
  const now = '2026-11-19T09:00:00.000Z';
  assert.strictEqual(isDuplicateToday([record], 'anon-1', 100, now), false);
});
