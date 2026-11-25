const express = require('express');

const llm = require('../llm');
const { buildDraftPrompt, parseDraftResponse } = require('../../shared/reviewDraft');

const router = express.Router();

const MAX_TEXT_LENGTH = 100;

// POST /api/reviews/draft
// 한 줄 추천 문장을 받아 LLM으로 가격과 태그 초안을 뽑아 돌려준다 (R10).
// 키가 없거나 호출이 실패하거나 한도를 넘으면 빈 초안을 돌려줘 직접 입력할 수 있게 한다
router.post('/', async (req, res) => {
  const { text, placeName, category } = req.body || {};

  if (typeof text !== 'string' || text.trim() === '') {
    res.status(400).json({ error: '한 줄 추천 문장을 입력해 주세요.' });
    return;
  }

  const trimmedText = text.trim();
  if (trimmedText.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: `한 줄 추천은 ${MAX_TEXT_LENGTH}자 이하로 입력해 주세요.` });
    return;
  }

  try {
    const prompt = buildDraftPrompt({
      text: trimmedText,
      placeName,
      category,
    });
    const raw = await llm.generateJson(prompt, { clientKey: req.ip });
    const draft = parseDraftResponse(raw);
    res.json({ draft, source: 'llm' });
  } catch (err) {
    res.json({
      draft: { price: null, tags: [] },
      source: 'empty',
      message: 'AI 초안을 불러오지 못했습니다. 가격과 태그를 직접 입력해 주세요.',
    });
  }
});

module.exports = router;