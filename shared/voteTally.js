// R8: 같이 정하기 방의 투표 집계.
//
// 표가 가장 많은 가게로 정한다.
// 동점이면 도보 시간이 짧은 쪽, 그것도 같으면 먼저 후보에 오른 쪽.
// 한 사람 한 표이고 다시 투표하면 바뀐다. 표가 하나도 없으면 마감할 수 없다.
//
// 쓰는 값의 모양
//   후보(candidates): [{ placeId, walkMinutes }]  배열 순서가 후보에 오른 순서다
//   표(votes):        [{ anonId, placeId }]       한 사람당 하나만 들어 있다
// 도보 시간(walkMinutes)은 R1로 계산한 값을 받아서 쓴다. 여기서 직접 계산하지 않는다.

// 표를 넣은 새 배열을 돌려준다. 받은 배열은 바꾸지 않는다.
// 이미 투표한 사람이면 전에 넣은 표를 빼고 새 표를 넣는다 (한 사람 한 표)
function castVote(votes, anonId, placeId) {
  const current = Array.isArray(votes) ? votes : [];
  const others = current.filter((vote) => vote && vote.anonId !== anonId);
  others.push({ anonId: anonId, placeId: placeId });
  return others;
}

// 후보별로 받은 표 수를 센다. { 가게 id: 표 수 } 모양으로 돌려준다.
// 후보에 없는 가게로 들어온 표는 세지 않는다
function countVotes(candidates, votes) {
  const counts = {};
  for (const candidate of candidates) {
    counts[candidate.placeId] = 0;
  }

  // 같은 사람의 표가 여러 개 들어 있으면 마지막 것만 센다.
  // castVote를 거치면 생기지 않는 경우지만, 잘못 저장된 데이터가 와도 한 사람 한 표를 지킨다
  const lastVoteByPerson = new Map();
  for (const vote of votes) {
    if (vote) {
      lastVoteByPerson.set(vote.anonId, vote.placeId);
    }
  }

  // "constructor" 같은 이름은 객체에 원래 들어 있는 것이라 in으로 보면 있다고 나온다.
  // 후보로 넣어 둔 가게인지만 보려고 Object.hasOwn을 쓴다
  for (const placeId of lastVoteByPerson.values()) {
    if (Object.hasOwn(counts, placeId)) {
      counts[placeId] += 1;
    }
  }

  return counts;
}

// 도보 시간을 비교할 수 있는 숫자로 바꾼다. 값이 없거나 숫자가 아니면 가장 먼 것으로 친다
function walkOf(candidate) {
  const minutes = candidate.walkMinutes;
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) {
    return Infinity;
  }
  return minutes;
}

// 투표를 집계해서 정해진 가게를 돌려준다.
//   정해졌으면  { ok: true, value: { winnerId, counts } }
//   못 정하면    { ok: false, error: '이유' }
function tallyVotes(candidates, votes) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: false, error: '후보가 없습니다.' };
  }

  const counts = countVotes(candidates, Array.isArray(votes) ? votes : []);

  // 앞에서부터 보면서 지금까지의 1등보다 나은 후보가 나오면 바꾼다.
  // 표도 같고 도보 시간도 같으면 바꾸지 않으므로 먼저 후보에 오른 쪽이 남는다
  let winner = null;
  for (const candidate of candidates) {
    if (winner === null) {
      winner = candidate;
      continue;
    }

    const moreVotes = counts[candidate.placeId] > counts[winner.placeId];
    const sameVotes = counts[candidate.placeId] === counts[winner.placeId];
    const closer = walkOf(candidate) < walkOf(winner);

    if (moreVotes || (sameVotes && closer)) {
      winner = candidate;
    }
  }

  if (counts[winner.placeId] === 0) {
    return { ok: false, error: '표가 하나도 없어서 마감할 수 없습니다.' };
  }

  return {
    ok: true,
    value: {
      winnerId: winner.placeId,
      counts: counts,
    },
  };
}

module.exports = {
  castVote,
  countVotes,
  tallyVotes,
};
