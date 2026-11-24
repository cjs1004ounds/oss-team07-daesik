// 같이 정하기 방의 규칙. 후보 검사와 방 코드.
// 투표 집계(R8)는 voteTally.js에 따로 있다

// 후보는 2곳 이상 6곳 이하. 한 곳이면 정할 게 없고, 너무 많으면 투표가 흩어진다
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 6;

// 방 코드에 쓰는 글자. 읽을 때 헷갈리는 0, O, 1, I는 뺐다
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

const MAX_ID_LENGTH = 50;
const MAX_NAME_LENGTH = 100;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// 후보 하나. 검색 결과의 가게 모양({ id, name, lat, lng, category })을 받는다
function isValidCandidate(place) {
  if (!place || typeof place !== 'object' || Array.isArray(place)) {
    return false;
  }
  if (typeof place.id !== 'string' || place.id.trim() === '' || place.id.trim().length > MAX_ID_LENGTH) {
    return false;
  }
  if (typeof place.name !== 'string' || place.name.trim() === '' || place.name.trim().length > MAX_NAME_LENGTH) {
    return false;
  }
  if (!isNumber(place.lat) || !isNumber(place.lng)) {
    return false;
  }
  if (typeof place.category !== 'string') {
    return false;
  }
  return true;
}

// 후보 목록을 검사하고, 저장할 모양({ placeId, name, lat, lng, category })으로 바꾼다.
//   통과하면 { ok: true, value: [후보...] }  배열 순서가 후보에 오른 순서다(R8 동점 처리)
//   아니면   { ok: false, error: '이유' }
function validateCandidates(candidates) {
  if (!Array.isArray(candidates)) {
    return { ok: false, error: '후보 가게 목록이 필요합니다.' };
  }
  if (candidates.length < MIN_CANDIDATES || candidates.length > MAX_CANDIDATES) {
    return { ok: false, error: `후보 가게는 ${MIN_CANDIDATES}곳에서 ${MAX_CANDIDATES}곳까지 고를 수 있습니다.` };
  }

  const value = [];
  const seen = new Set();
  for (const place of candidates) {
    if (!isValidCandidate(place)) {
      return { ok: false, error: '후보 가게 정보가 올바르지 않습니다.' };
    }
    const placeId = place.id.trim();
    if (seen.has(placeId)) {
      return { ok: false, error: '같은 가게를 두 번 넣을 수 없습니다.' };
    }
    seen.add(placeId);
    value.push({
      placeId: placeId,
      name: place.name.trim(),
      lat: place.lat,
      lng: place.lng,
      category: place.category.trim(),
    });
  }

  return { ok: true, value: value };
}

// 방 코드를 만든다. randomInt(n)은 0 이상 n 미만의 정수를 돌려주는 함수다.
// 서버에서는 crypto.randomInt를 넘기고, 테스트에서는 정해진 값을 돌려주는 함수를 넘긴다
function makeRoomCode(randomInt) {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)];
  }
  return code;
}

// 주소로 들어온 방 코드를 비교하기 좋게 바꾼다. 소문자로 입력해도 같은 방으로 본다.
// 모양이 맞지 않으면 null
function normalizeRoomCode(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const code = text.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) {
    return null;
  }
  for (const char of code) {
    if (!ROOM_CODE_CHARS.includes(char)) {
      return null;
    }
  }
  return code;
}

module.exports = {
  MIN_CANDIDATES,
  MAX_CANDIDATES,
  ROOM_CODE_CHARS,
  ROOM_CODE_LENGTH,
  validateCandidates,
  makeRoomCode,
  normalizeRoomCode,
};
