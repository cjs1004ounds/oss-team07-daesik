const express = require('express');

const store = require('../store');
const { countRecordsByPerson, titleFor } = require('../../shared/badges');

const router = express.Router();

const MAX_ANON_ID_LENGTH = 100;

// GET /api/me/:anonId
// 이 익명 ID의 기록 수와 칭호 (R18). 교내 인증 상태에서 남긴 기록만 센다
router.get('/:anonId', (req, res) => {
  const anonId = typeof req.params.anonId === 'string' ? req.params.anonId.trim() : '';
  if (anonId === '' || anonId.length > MAX_ANON_ID_LENGTH) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }

  const counts = countRecordsByPerson(store.getReviews(), store.getVisits());
  const mine = counts.get(anonId) || { recordCount: 0, placeCount: 0 };
  res.json({ ...mine, ...titleFor(mine.recordCount) });
});

module.exports = router;
