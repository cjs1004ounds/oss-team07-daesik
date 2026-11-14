const express = require('express');

const router = express.Router();

// GET /api/health
// 서버가 살아 있는지 확인하는 용도
router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
