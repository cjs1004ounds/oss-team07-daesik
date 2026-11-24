const crypto = require('crypto');
const express = require('express');

const store = require('../store');
const { validateCandidates, makeRoomCode, normalizeRoomCode } = require('../../shared/roomRules');
const { castVote, countVotes, tallyVotes } = require('../../shared/voteTally');

const router = express.Router();

const MAX_ANON_ID_LENGTH = 100;

function isValidAnonId(anonId) {
  return typeof anonId === 'string' && anonId.trim() !== '' && anonId.trim().length <= MAX_ANON_ID_LENGTH;
}

// 방을 화면에 내보낼 모양으로 바꾼다.
// 후보마다 받은 표 수만 붙이고, 누가 어디에 투표했는지와 익명 ID는 내보내지 않는다
function toRoomResponse(room) {
  const counts = countVotes(room.candidates, room.votes);
  let totalVotes = 0;
  const candidates = room.candidates.map((candidate) => {
    totalVotes += counts[candidate.placeId];
    return { ...candidate, votes: counts[candidate.placeId] };
  });

  return {
    code: room.code,
    candidates: candidates,
    totalVotes: totalVotes,
    closed: room.closed,
    winnerId: room.winnerId,
    createdAt: room.createdAt,
    closedAt: room.closedAt,
  };
}

// 주소의 방 코드로 방을 찾는다. 없으면 404를 보내고 null을 돌려준다
function findRoom(req, res) {
  const code = normalizeRoomCode(req.params.code);
  const room = code ? store.getRoom(code) : null;
  if (!room) {
    res.status(404).json({ error: '없는 방입니다. 방 코드를 확인해 주세요.' });
    return null;
  }
  return room;
}

// 겹치지 않는 방 코드를 만든다. 32글자 6자리라 겹칠 일은 거의 없지만 몇 번 다시 뽑는다
function newRoomCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = makeRoomCode(crypto.randomInt);
    if (!store.getRoom(code)) {
      return code;
    }
  }
  return null;
}

// POST /api/rooms
// 방을 만든다. 만든 사람이 후보 가게를 2~6곳 고른다
router.post('/', (req, res) => {
  const { anonId, candidates } = req.body || {};

  if (!isValidAnonId(anonId)) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }

  const result = validateCandidates(candidates);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  const code = newRoomCode();
  if (!code) {
    res.status(500).json({ error: '방을 만들지 못했습니다. 다시 해 주세요.' });
    return;
  }

  const room = store.addRoom({ code: code, candidates: result.value, ownerAnonId: anonId.trim() });
  res.status(201).json({ room: toRoomResponse(room) });
});

// GET /api/rooms/:code
// 방의 후보, 후보별 표 수, 마감 여부. 화면은 몇 초마다 이걸 다시 불러 투표 현황을 갱신한다
router.get('/:code', (req, res) => {
  const room = findRoom(req, res);
  if (!room) {
    return;
  }
  res.json({ room: toRoomResponse(room) });
});

// POST /api/rooms/:code/votes
// 투표. 한 사람 한 표이고 다시 투표하면 바뀐다 (R8)
router.post('/:code/votes', (req, res) => {
  const room = findRoom(req, res);
  if (!room) {
    return;
  }

  const { anonId, placeId } = req.body || {};
  if (!isValidAnonId(anonId)) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }
  if (typeof placeId !== 'string' || !room.candidates.some((candidate) => candidate.placeId === placeId.trim())) {
    res.status(400).json({ error: '이 방의 후보 가게가 아닙니다.' });
    return;
  }
  if (room.closed) {
    res.status(409).json({ error: '이미 마감된 방입니다.' });
    return;
  }

  const votes = castVote(room.votes, anonId.trim(), placeId.trim());
  const updated = store.updateRoom(room.code, { votes: votes });
  res.json({ room: toRoomResponse(updated) });
});

// POST /api/rooms/:code/close
// 마감하고 가게를 정한다 (R8). 방을 만든 사람만 할 수 있다
router.post('/:code/close', (req, res) => {
  const room = findRoom(req, res);
  if (!room) {
    return;
  }

  const { anonId } = req.body || {};
  if (!isValidAnonId(anonId)) {
    res.status(400).json({ error: '익명 ID가 필요합니다.' });
    return;
  }
  if (anonId.trim() !== room.ownerAnonId) {
    res.status(403).json({ error: '방을 만든 사람만 마감할 수 있습니다.' });
    return;
  }
  if (room.closed) {
    res.status(409).json({ error: '이미 마감된 방입니다.' });
    return;
  }

  // 도보 시간(R1)이 아직 없어서, 표가 같으면 먼저 후보에 오른 가게로 정해진다
  const result = tallyVotes(room.candidates, room.votes);
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }

  const updated = store.updateRoom(room.code, { closed: true, winnerId: result.value.winnerId });
  res.json({ room: toRoomResponse(updated) });
});

module.exports = router;
