const express = require('express');

const store = require('../store');
const { validateReviewInput, validateMenu } = require('../../shared/reviewValidator');
const { isDuplicateToday } = require('../../shared/duplicateLimit');

const router = express.Router();

//가게 정보 형식 검사 함수
function isValidPlace(place) {
  if (!place || typeof place !== 'object' || Array.isArray(place)) {
    return false;
  }
  if (typeof place.id !== 'string' || place.id.trim() === '') {
    return false;
  }
  if (typeof place.name !== 'string' || place.name.trim() === '') {
    return false;
  }
  if (typeof place.lat !== 'number' || !Number.isFinite(place.lat)) {
    return false;
  }
  if (typeof place.lng !== 'number' || !Number.isFinite(place.lng)) {
    return false;
  }
  if (typeof place.category !== 'string') {
    return false;
  }
  return true;
}

// POST /api/reviews
// 한 줄 추천을 저장한다. 처음 기록되는 가게면 가게도 같이 저장한다
router.post('/', (req, res) => {
  const { place, text, price, tags, anonId } = req.body || {};

  if (!isValidPlace(place)) {
    res.status(400).json({ error: '가게 정보가 올바르지 않습니다.' });
    return;
  }

  if (typeof anonId !== 'string' || anonId.trim() === '') {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }

  const result = validateReviewInput({ text, price, tags }); //R6 입력값 검증
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  // 먹은 메뉴는 선택 칸이다 (R6)
  const menuResult = validateMenu((req.body || {}).menu);
  if (!menuResult.ok) {
    res.status(400).json({ error: menuResult.error });
    return;
  }

  const placeId = place.id.trim();
  const trimmedAnonId = anonId.trim();

  if (isDuplicateToday(store.getReviewsByPlace(placeId), trimmedAnonId, placeId, new Date())) {
    res.status(409).json({ error: '오늘은 이미 이 가게에 한 줄 추천을 남겼습니다.' });
    return;
  }

  store.addPlace({
    id: placeId,
    name: place.name.trim(),
    lat: place.lat,
    lng: place.lng,
    category: place.category.trim(),
  });

  const savedReview = store.addReview({
    placeId,
    text: result.value.text,
    price: result.value.price,
    tags: result.value.tags,
    menu: menuResult.value,
    anonId: trimmedAnonId,
  });

  const { anonId: _excluded, ...publicReview } = savedReview;
  res.status(201).json({ review: publicReview });
});

module.exports = router;