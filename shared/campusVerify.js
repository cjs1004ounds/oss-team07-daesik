// 교내 인증 규칙 (R11, R12, R13)
// 학교에 와 있는지를 위치나 접속 IP로 판정한다. 학생인지는 알 수 없다 (README "교내 인증")

// 캠퍼스 가운데. 카카오에서 찾은 건물들(새빛관, 참빛관, 누리관, 빛솔재 등) 좌표의 가운데다.
// 지도와 검색에 쓰는 학교 기준점과는 따로 둔다
const CAMPUS_CENTER = { lat: 37.6201, lng: 127.058 };

// 가운데에서 가장 먼 건물(참빛관)이 약 280m라서 조금 넉넉하게 잡았다
const CAMPUS_RADIUS_M = 350;

// 브라우저가 알려 주는 위치 오차(m)가 이보다 크면 판정하지 않는다
const MAX_ACCURACY_M = 150;

// 인증을 유지하는 기간
const VERIFY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const EARTH_RADIUS_M = 6371000;

function toRadians(degree) {
  return (degree * Math.PI) / 180;
}

// 두 좌표 사이의 직선거리(m). 지구를 공으로 보고 계산한다(하버사인 공식)
function distanceMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// R11 위치 판정.
// 통과하면 { ok: true }, 아니면 { ok: false, reason, error }
//   reason: 'invalid'(좌표가 잘못됨), 'inaccurate'(오차가 큼), 'outside'(캠퍼스 밖)
function checkLocation(location) {
  if (!location || !isNumber(location.lat) || !isNumber(location.lng)) {
    return { ok: false, reason: 'invalid', error: '위치 값이 올바르지 않습니다.' };
  }
  if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180) {
    return { ok: false, reason: 'invalid', error: '위치 값이 올바르지 않습니다.' };
  }
  if (!isNumber(location.accuracy) || location.accuracy < 0) {
    return { ok: false, reason: 'invalid', error: '위치 정확도 값이 올바르지 않습니다.' };
  }

  if (location.accuracy > MAX_ACCURACY_M) {
    return {
      ok: false,
      reason: 'inaccurate',
      error: '위치가 정확하지 않습니다. 창가나 건물 밖에서 다시 해 보거나 학교 와이파이에 연결해 주세요.',
    };
  }

  // 오차 범위는 따로 더하지 않는다. 오차가 150m 이하일 때만 판정하므로 반경 350m 안에서 충분하다
  if (distanceMeters(CAMPUS_CENTER, location) > CAMPUS_RADIUS_M) {
    return { ok: false, reason: 'outside', error: '학교 안에서만 인증할 수 있습니다.' };
  }

  return { ok: true };
}

// 환경 변수에 쉼표로 적은 IP 앞부분들을 배열로 바꾼다.
// 예: "203.0.113., 198.51.100." -> ['203.0.113.', '198.51.100.']
function parseIpPrefixes(text) {
  if (typeof text !== 'string') {
    return [];
  }
  return text
    .split(',')
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix !== '');
}

// R12 와이파이 판정. 접속 IP가 학교 대역(앞부분이 같은지)이면 통과.
// IPv6로 들어온 IPv4 주소("::ffff:203.0.113.5")는 앞의 "::ffff:"를 떼고 본다
function isCampusIp(ip, prefixes) {
  if (typeof ip !== 'string' || ip === '' || !Array.isArray(prefixes)) {
    return false;
  }
  const address = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  return prefixes.some((prefix) => prefix !== '' && address.startsWith(prefix));
}

// R13 인증한 시각에서 30일 뒤. ISO 문자열로 돌려준다
function getExpiresAt(verifiedAt) {
  const time = new Date(verifiedAt).getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  return new Date(time + VERIFY_DAYS * DAY_MS).toISOString();
}

// R13 지금(now) 인증이 살아 있는지. 30일이 되는 순간부터는 만료로 본다
function isVerificationActive(verification, now) {
  if (!verification || typeof verification.verifiedAt !== 'string') {
    return false;
  }
  const expiresAt = getExpiresAt(verification.verifiedAt);
  if (expiresAt === null) {
    return false;
  }
  const verifiedTime = new Date(verification.verifiedAt).getTime();
  const nowTime = new Date(now).getTime();
  // 인증한 시각이 지금보다 뒤면(시계가 어긋난 기록) 믿지 않는다
  if (verifiedTime > nowTime) {
    return false;
  }
  return nowTime < new Date(expiresAt).getTime();
}

module.exports = {
  CAMPUS_CENTER,
  CAMPUS_RADIUS_M,
  MAX_ACCURACY_M,
  VERIFY_DAYS,
  distanceMeters,
  checkLocation,
  parseIpPrefixes,
  isCampusIp,
  getExpiresAt,
  isVerificationActive,
};
