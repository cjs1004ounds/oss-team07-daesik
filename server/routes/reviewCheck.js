const express = require('express');

const llm = require('../llm');
const { findByRules, buildCheckPrompt, parseCheck, mergeIssues } = require('../../shared/reviewCheck');

const router = express.Router();

// 한 줄 추천 최대 길이(R6)와 같다
const MAX_TEXT_LENGTH = 100;
const MAX_PLACE_NAME_LENGTH = 100;

// 저장 버튼을 누른 뒤에 기다리는 검사라 오래 기다리지 않는다
const CHECK_TIMEOUT_MS = 4000;

// POST /api/reviews/check
// 저장하기 전에 한 줄 추천에 문제 될 내용이 있는지 알려 준다. 저장하지는 않는다.
// 규칙(전화번호, 이메일, 학번)은 늘 보고, LLM은 쓸 수 있을 때만 본다
router.post('/', async (req, res) => {
  const { text, placeName } = req.body || {};

  if (typeof text !== 'string' || text.trim() === '' || text.trim().length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: '검사할 한 줄 추천이 필요합니다. 100자까지 받습니다.' });
    return;
  }
  const name = typeof placeName === 'string' ? placeName.trim().slice(0, MAX_PLACE_NAME_LENGTH) : '';

  const ruleIssues = findByRules(text);
  const checkedBy = ['rules'];

  let llmIssues = [];
  try {
    const raw = await llm.generateJson(buildCheckPrompt(name, text.trim()), {
      timeoutMs: CHECK_TIMEOUT_MS,
      clientKey: req.ip,
    });
    const result = parseCheck(raw);
    if (result.ok) {
      llmIssues = result.value;
      checkedBy.push('llm');
    } else {
      console.error('작성 전 검사 응답을 쓸 수 없습니다: ' + result.error);
    }
  } catch (err) {
    console.error('작성 전 검사 실패: ' + err.message);
  }

  res.json({ issues: mergeIssues(ruleIssues, llmIssues), checkedBy: checkedBy });
});

module.exports = router;
