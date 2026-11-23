const express = require('express');

const store = require('../store');
const {
  checkLocation,
  parseIpPrefixes,
  isCampusIp,
  getExpiresAt,
  isVerificationActive,
} = require('../../shared/campusVerify');

const router = express.Router();

// 익명 ID는 브라우저가 만든 UUID라 36자다. 너무 긴 값은 저장하지 않는다
const MAX_ANON_ID_LENGTH = 100;

function isValidAnonId(anonId) {
  return typeof anonId === 'string' && anonId.trim() !== '' && anonId.length <= MAX_ANON_ID_LENGTH;
}

// 저장된 인증 기록을 응답 모양으로 바꾼다. 익명 ID는 다시 돌려주지 않는다
function toResponse(verification) {
  return {
    verified: true,
    method: verification.method,
    verifiedAt: verification.verifiedAt,
    expiresAt: getExpiresAt(verification.verifiedAt),
  };
}

// POST /api/verify
// 교내 인증. 학교 와이파이(R12)면 바로 통과하고, 아니면 보낸 위치로 판정한다(R11).
// 좌표와 IP는 판정에만 쓰고 저장하지도, 로그에 남기지도 않는다
router.post('/', (req, res) => {
  const { anonId, lat, lng, accuracy } = req.body || {};

  if (!isValidAnonId(anonId)) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }
  const id = anonId.trim();

  // 학교 대역은 서버 환경 변수로 정한다. 비어 있으면 와이파이 판정은 하지 않는다
  const campusPrefixes = parseIpPrefixes(process.env.CAMPUS_IP_PREFIXES);
  if (isCampusIp(req.ip, campusPrefixes)) {
    res.json(toResponse(store.saveVerification(id, 'wifi')));
    return;
  }

  // 와이파이로 통과하지 못했는데 위치도 안 보냈으면, 화면이 위치를 물어보게 알려 준다
  if (lat === undefined && lng === undefined && accuracy === undefined) {
    res.status(403).json({
      error: '학교 와이파이로 접속하지 않았습니다. 위치로 인증하려면 위치 권한을 허락해 주세요.',
      needLocation: true,
    });
    return;
  }

  const result = checkLocation({ lat, lng, accuracy });
  if (!result.ok) {
    // 값이 잘못된 건 400, 값은 맞는데 캠퍼스 밖이거나 부정확한 건 403
    res.status(result.reason === 'invalid' ? 400 : 403).json({ error: result.error });
    return;
  }

  res.json(toResponse(store.saveVerification(id, 'location')));
});

// GET /api/verify/:anonId
// 이 익명 ID가 지금 교내 인증돼 있는지. 30일이 지났으면 verified: false (R13)
router.get('/:anonId', (req, res) => {
  const anonId = req.params.anonId;
  if (!isValidAnonId(anonId)) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }

  const verification = store.getVerification(anonId.trim());
  if (!isVerificationActive(verification, new Date())) {
    res.json({ verified: false });
    return;
  }
  res.json(toResponse(verification));
});

module.exports = router;
