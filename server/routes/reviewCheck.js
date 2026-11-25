const express = require('express');

const llm = require('../llm');
const store = require('../store');
const priceRanges = require('../priceRanges');
const { findByRules, buildCheckPrompt, parseCheck, mergeIssues } = require('../../shared/reviewCheck');
const { parsePricesFromText, checkPrice, peerPricesOf, categoryKey, holdMessage } = require('../../shared/priceCheck');

const router = express.Router();

// 한 줄 추천 최대 길이(R6)와 같다
const MAX_TEXT_LENGTH = 100;
const MAX_PLACE_NAME_LENGTH = 100;
const MAX_ID_LENGTH = 50;
const MAX_CATEGORY_LENGTH = 100;

// 저장 버튼을 누른 뒤에 기다리는 검사라 오래 기다리지 않는다
const CHECK_TIMEOUT_MS = 4000;

function shortText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// 글의 문제를 LLM에게 묻는다. 쓸 수 없으면 null
async function checkWithLlm(name, text, clientKey) {
  try {
    const raw = await llm.generateJson(buildCheckPrompt(name, text), { timeoutMs: CHECK_TIMEOUT_MS, clientKey: clientKey });
    const result = parseCheck(raw);
    if (result.ok) {
      return result.value;
    }
    console.error('작성 전 검사 응답을 쓸 수 없습니다: ' + result.error);
  } catch (err) {
    console.error('작성 전 검사 실패: ' + err.message);
  }
  return null;
}

// POST /api/reviews/check
// 저장하기 전에 한 줄 추천에 문제 될 내용이 있는지 알려 준다. 저장하지는 않는다.
// 규칙(전화번호, 이메일, 학번)과 가격 검사(R17)는 늘 보고, LLM은 쓸 수 있을 때만 본다
router.post('/', async (req, res) => {
  const { text, placeName, price, placeId, category } = req.body || {};

  if (typeof text !== 'string' || text.trim() === '' || text.trim().length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: '검사할 한 줄 추천이 필요합니다. 100자까지 받습니다.' });
    return;
  }
  const trimmedText = text.trim();
  const name = shortText(placeName, MAX_PLACE_NAME_LENGTH);
  const hasPrice = typeof price === 'number' && Number.isFinite(price);

  // 보통 가격 범위는 글에 가격이 없을 때만 필요하다. 글 검사와 같이 기다린다
  const rangeKey = categoryKey(shortText(category, MAX_CATEGORY_LENGTH));
  const needsRange = hasPrice && rangeKey !== '' && parsePricesFromText(trimmedText).length === 0;
  const [llmIssues, range] = await Promise.all([
    checkWithLlm(name, trimmedText, req.ip),
    needsRange ? priceRanges.ensureRange(rangeKey, req.ip) : null,
  ]);

  const issues = [];
  if (hasPrice) {
    const id = shortText(placeId, MAX_ID_LENGTH);
    const others = id === '' ? [] : peerPricesOf(store.getReviewsByPlace(id), null);
    const hold = checkPrice(price, trimmedText, others, range);
    if (hold) {
      const issue = { kind: 'price', message: holdMessage(hold, price) };
      if (hold.reason === 'text' && hold.suggestedPrice) {
        issue.suggestedPrice = hold.suggestedPrice;
      }
      issues.push(issue);
    }
  }
  issues.push(...findByRules(trimmedText));

  res.json({
    issues: mergeIssues(issues, llmIssues || []),
    checkedBy: llmIssues ? ['rules', 'llm'] : ['rules'],
  });
});

module.exports = router;
