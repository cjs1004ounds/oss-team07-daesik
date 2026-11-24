const express = require('express');

const store = require('../store');
const { isDuplicateToday } = require('../../shared/duplicateLimit');

const router = express.Router();

const MAX_PLACE_ID_LENGTH = 50;
const MAX_ANON_ID_LENGTH = 100;
const MAX_ROOM_CODE_LENGTH = 50;

function isValidPlace(place) {
  if (!place || typeof place !== 'object' || Array.isArray(place)) {
    return false;
  }
  if (typeof place.id !== 'string' || place.id.trim() === '' || place.id.trim().length > MAX_PLACE_ID_LENGTH) {
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

// POST /api/visits
// "또 갈래요"(again: true) 또는 "글쎄요"(again: false) 응답을 저장한다.
// R7: 같은 익명 ID는 같은 가게에 한국 시간 기준 하루에 한 번만 응답할 수 있다
router.post('/', (req, res) => {
  const { place, placeId, again, anonId, roomCode } = req.body || {};

  if (typeof again !== 'boolean') {
    res.status(400).json({ error: '또 갈래요 여부(again)는 true 또는 false여야 합니다.' });
    return;
  }

  if (typeof anonId !== 'string' || anonId.trim() === '' || anonId.trim().length > MAX_ANON_ID_LENGTH) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }

  let normalizedRoomCode = null;
  if (roomCode !== undefined && roomCode !== null) {
    if (typeof roomCode !== 'string' || roomCode.trim().length > MAX_ROOM_CODE_LENGTH) {
      res.status(400).json({ error: '방 코드가 올바르지 않습니다.' });
      return;
    }
    if (roomCode.trim() !== '') {
      normalizedRoomCode = roomCode.trim();
    }
  }

  let targetPlaceId = '';
  if (place !== undefined) {
    if (!isValidPlace(place)) {
      res.status(400).json({ error: '가게 정보가 올바르지 않습니다.' });
      return;
    }
    targetPlaceId = place.id.trim();
  } else {
    if (typeof placeId !== 'string' || placeId.trim() === '' || placeId.trim().length > MAX_PLACE_ID_LENGTH) {
      res.status(400).json({ error: '가게 ID가 필요합니다.' });
      return;
    }
    targetPlaceId = placeId.trim();
    if (!store.getPlace(targetPlaceId)) {
      res.status(404).json({ error: '없는 가게입니다.' });
      return;
    }
  }

  const trimmedAnonId = anonId.trim();

  if (isDuplicateToday(store.getVisitsByPlace(targetPlaceId), trimmedAnonId, targetPlaceId, new Date())) {
    res.status(409).json({ error: '오늘은 이미 이 가게에 다녀왔어요 응답을 남겼습니다.' });
    return;
  }

  if (place !== undefined) {
    store.addPlace({
      id: targetPlaceId,
      name: place.name.trim(),
      lat: place.lat,
      lng: place.lng,
      category: place.category.trim(),
    });
  }

  const savedVisit = store.addVisit({
    placeId: targetPlaceId,
    again,
    anonId: trimmedAnonId,
    roomCode: normalizedRoomCode,
  });

  const { anonId: _excluded, ...publicVisit } = savedVisit;
  res.status(201).json({ visit: publicVisit });
});

module.exports = router;