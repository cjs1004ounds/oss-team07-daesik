const express = require('express');

const store = require('../store');
const llm = require('../llm');
const { hasReported, decideHide } = require('../../shared/reportRules');
const { buildModerationPrompt, parseModeration } = require('../../shared/moderation');

const router = express.Router();

const MAX_ID_LENGTH = 100;

function isValidId(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim().length <= MAX_ID_LENGTH;
}

// 신고된 글을 LLM에게 한 번 물어본다. 이미 물어본 글이면 저장해 둔 판단을 쓴다.
// 키가 없거나 호출이 실패하면 null을 돌려주고, 숨길지는 신고 수로만 정해진다
async function getModeration(review, clientKey) {
  if (review.moderation) {
    return review.moderation;
  }

  try {
    const place = store.getPlace(review.placeId);
    const prompt = buildModerationPrompt(place ? place.name : '', review.text);
    const result = parseModeration(await llm.generateJson(prompt, { clientKey: clientKey }));
    if (!result.ok) {
      console.error('LLM 판단을 쓸 수 없습니다: ' + result.error);
      return null;
    }
    store.setReviewModeration(review.id, result.value);
    return result.value;
  } catch (err) {
    // 오류 내용에는 키가 들어가지 않는다 (server/llm.js)
    console.error('LLM 판단 실패: ' + err.message);
    return null;
  }
}

// POST /api/reports
// 한 줄 추천을 신고한다. 신고 수와 LLM 판단으로 숨길지 정한다 (R15)
router.post('/', async (req, res) => {
  const { reviewId, anonId } = req.body || {};

  if (!isValidId(reviewId)) {
    res.status(400).json({ error: '신고할 한 줄 추천이 필요합니다.' });
    return;
  }
  if (!isValidId(anonId)) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }

  const id = reviewId.trim();
  const reporter = anonId.trim();

  const review = store.getReview(id);
  if (!review) {
    res.status(404).json({ error: '없는 한 줄 추천입니다.' });
    return;
  }
  if (review.hidden) {
    res.status(409).json({ error: '이미 숨겨진 한 줄 추천입니다.' });
    return;
  }
  if (hasReported(store.getReportsByReview(id), id, reporter)) {
    res.status(409).json({ error: '이미 신고한 한 줄 추천입니다.' });
    return;
  }

  const report = store.addReport({ reviewId: id, anonId: reporter });
  const moderation = await getModeration(review, req.ip);
  const decision = decideHide(store.getReportsByReview(id), moderation);
  if (decision.hide) {
    store.hideReview(id, decision.reason);
  }

  res.status(201).json({
    report: { id: report.id, reviewId: report.reviewId, createdAt: report.createdAt },
    hidden: decision.hide,
  });
});

module.exports = router;
