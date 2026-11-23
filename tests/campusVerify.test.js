const test = require('node:test');
const assert = require('node:assert');

const {
  CAMPUS_CENTER,
  distanceMeters,
  checkLocation,
  parseIpPrefixes,
  isCampusIp,
  getExpiresAt,
  isVerificationActive,
} = require('../shared/campusVerify');

// 위도 1도는 약 111,195m. 가운데에서 북쪽으로 meters만큼 간 좌표를 만든다
function north(meters, accuracy = 30) {
  return { lat: CAMPUS_CENTER.lat + meters / 111195, lng: CAMPUS_CENTER.lng, accuracy };
}

// 거리 계산

test('같은 좌표의 거리는 0이다', () => {
  assert.strictEqual(distanceMeters(CAMPUS_CENTER, CAMPUS_CENTER), 0);
});

test('북쪽으로 100m 간 좌표는 약 100m로 계산된다', () => {
  const d = distanceMeters(CAMPUS_CENTER, north(100));
  assert.ok(Math.abs(d - 100) < 1, `계산된 거리 ${d}`);
});

// R11 위치 판정

test('캠퍼스 건물 좌표는 통과한다 (참빛관, 누리관, 빛솔재)', () => {
  // 카카오에서 찾은 좌표. 가운데에서 가장 먼 건물들이다
  assert.deepStrictEqual(checkLocation({ lat: 37.61925, lng: 127.06097, accuracy: 20 }), { ok: true });
  assert.deepStrictEqual(checkLocation({ lat: 37.62040, lng: 127.05500, accuracy: 20 }), { ok: true });
  assert.deepStrictEqual(checkLocation({ lat: 37.62148, lng: 127.05633, accuracy: 20 }), { ok: true });
});

test('반경 350m 바로 안은 통과하고 바로 밖은 캠퍼스 밖이다', () => {
  assert.deepStrictEqual(checkLocation(north(345)), { ok: true });
  assert.strictEqual(checkLocation(north(355)).reason, 'outside');
});

test('학교에서 멀리 떨어진 곳(석계역 근처)은 캠퍼스 밖이다', () => {
  const result = checkLocation({ lat: 37.6148, lng: 127.0657, accuracy: 20 });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'outside');
  assert.strictEqual(typeof result.error, 'string');
});

test('오차가 150m면 판정하고 150m를 넘으면 다시 하게 한다', () => {
  assert.deepStrictEqual(checkLocation(north(0, 150)), { ok: true });
  assert.strictEqual(checkLocation(north(0, 151)).reason, 'inaccurate');
});

test('오차가 큰 위치는 캠퍼스 안이어도 통과하지 않는다', () => {
  const result = checkLocation(north(10, 1000));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'inaccurate');
});

test('좌표가 숫자가 아니거나 빠지면 잘못된 값이다', () => {
  assert.strictEqual(checkLocation(undefined).reason, 'invalid');
  assert.strictEqual(checkLocation({}).reason, 'invalid');
  assert.strictEqual(checkLocation({ lat: '37.62', lng: 127.058, accuracy: 10 }).reason, 'invalid');
  assert.strictEqual(checkLocation({ lat: NaN, lng: 127.058, accuracy: 10 }).reason, 'invalid');
  assert.strictEqual(checkLocation({ lat: 37.62, lng: Infinity, accuracy: 10 }).reason, 'invalid');
});

test('위도, 경도 범위를 벗어나면 잘못된 값이다', () => {
  assert.strictEqual(checkLocation({ lat: 91, lng: 127.058, accuracy: 10 }).reason, 'invalid');
  assert.strictEqual(checkLocation({ lat: 37.62, lng: -181, accuracy: 10 }).reason, 'invalid');
});

test('오차 값이 없거나 음수면 잘못된 값이다', () => {
  assert.strictEqual(checkLocation({ lat: 37.6201, lng: 127.058 }).reason, 'invalid');
  assert.strictEqual(checkLocation({ lat: 37.6201, lng: 127.058, accuracy: -1 }).reason, 'invalid');
});

// R12 와이파이 판정
// 예시 IP는 문서용으로 정해진 대역(203.0.113.0/24, 198.51.100.0/24)을 쓴다

test('환경 변수 문자열을 IP 앞부분 배열로 바꾼다', () => {
  assert.deepStrictEqual(parseIpPrefixes('203.0.113., 198.51.100.'), ['203.0.113.', '198.51.100.']);
  assert.deepStrictEqual(parseIpPrefixes(' 203.0.113. ,, '), ['203.0.113.']);
});

test('환경 변수가 없거나 비어 있으면 빈 배열이다', () => {
  assert.deepStrictEqual(parseIpPrefixes(undefined), []);
  assert.deepStrictEqual(parseIpPrefixes(''), []);
  assert.deepStrictEqual(parseIpPrefixes('  '), []);
});

test('학교 대역의 IP는 통과하고 다른 IP는 통과하지 않는다', () => {
  const prefixes = ['203.0.113.'];
  assert.strictEqual(isCampusIp('203.0.113.55', prefixes), true);
  assert.strictEqual(isCampusIp('198.51.100.7', prefixes), false);
});

test('앞부분이 비슷하기만 한 IP는 통과하지 않는다', () => {
  // "203.0.11"까지만 같은 203.0.11.5는 다른 대역이다
  assert.strictEqual(isCampusIp('203.0.11.5', ['203.0.113.']), false);
  assert.strictEqual(isCampusIp('1203.0.113.5', ['203.0.113.']), false);
});

test('IPv6 모양으로 들어온 IPv4 주소도 판정한다', () => {
  assert.strictEqual(isCampusIp('::ffff:203.0.113.55', ['203.0.113.']), true);
  assert.strictEqual(isCampusIp('::ffff:198.51.100.7', ['203.0.113.']), false);
});

test('학교 대역이 정해지지 않았거나 IP가 없으면 통과하지 않는다', () => {
  assert.strictEqual(isCampusIp('203.0.113.55', []), false);
  assert.strictEqual(isCampusIp('203.0.113.55', ['']), false);
  assert.strictEqual(isCampusIp('203.0.113.55', undefined), false);
  assert.strictEqual(isCampusIp(undefined, ['203.0.113.']), false);
  assert.strictEqual(isCampusIp('', ['203.0.113.']), false);
});

// R13 유지 기간

test('인증한 때부터 30일 뒤가 만료 시각이다', () => {
  assert.strictEqual(getExpiresAt('2026-11-23T03:00:00.000Z'), '2026-12-23T03:00:00.000Z');
});

test('인증 시각이 잘못된 값이면 만료 시각이 없다', () => {
  assert.strictEqual(getExpiresAt('어제'), null);
});

test('30일이 되기 직전까지는 살아 있고 30일이 되면 만료된다', () => {
  const verification = { verifiedAt: '2026-11-23T03:00:00.000Z' };
  assert.strictEqual(isVerificationActive(verification, new Date('2026-11-23T03:00:00.000Z')), true);
  assert.strictEqual(isVerificationActive(verification, new Date('2026-12-23T02:59:59.999Z')), true);
  assert.strictEqual(isVerificationActive(verification, new Date('2026-12-23T03:00:00.000Z')), false);
});

test('인증 기록이 없거나 시각이 잘못됐으면 인증되지 않은 것이다', () => {
  const now = new Date('2026-11-23T03:00:00.000Z');
  assert.strictEqual(isVerificationActive(null, now), false);
  assert.strictEqual(isVerificationActive({}, now), false);
  assert.strictEqual(isVerificationActive({ verifiedAt: '어제' }, now), false);
});

test('인증 시각이 지금보다 뒤인 기록은 믿지 않는다', () => {
  const verification = { verifiedAt: '2026-11-24T03:00:00.000Z' };
  assert.strictEqual(isVerificationActive(verification, new Date('2026-11-23T03:00:00.000Z')), false);
});
