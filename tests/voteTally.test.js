const test = require('node:test');
const assert = require('node:assert');

const { castVote, countVotes, tallyVotes } = require('../shared/voteTally');

// 후보 세 곳. 배열 순서가 후보에 오른 순서다
const candidates = [
  { placeId: 'A', walkMinutes: 8 },
  { placeId: 'B', walkMinutes: 5 },
  { placeId: 'C', walkMinutes: 5 },
];

// 사람 이름과 가게를 받아 표 목록을 만든다. 예: votesOf(['kim', 'A'], ['lee', 'B'])
function votesOf(...pairs) {
  return pairs.map(([anonId, placeId]) => ({ anonId, placeId }));
}

// 투표 넣기 (한 사람 한 표)

test('처음 투표하면 표가 하나 추가된다', () => {
  const votes = castVote([], 'kim', 'A');
  assert.deepStrictEqual(votes, [{ anonId: 'kim', placeId: 'A' }]);
});

test('다시 투표하면 전에 넣은 표가 새 표로 바뀐다', () => {
  let votes = castVote([], 'kim', 'A');
  votes = castVote(votes, 'kim', 'B');

  assert.deepStrictEqual(votes, [{ anonId: 'kim', placeId: 'B' }]);
});

test('다른 사람의 표는 그대로 남는다', () => {
  let votes = castVote([], 'kim', 'A');
  votes = castVote(votes, 'lee', 'A');
  votes = castVote(votes, 'kim', 'C');

  assert.strictEqual(votes.length, 2);
  assert.deepStrictEqual(countVotes(candidates, votes), { A: 1, B: 0, C: 1 });
});

test('받은 배열은 바꾸지 않고 새 배열을 돌려준다', () => {
  const before = votesOf(['kim', 'A']);
  const after = castVote(before, 'lee', 'B');

  assert.strictEqual(before.length, 1);
  assert.strictEqual(after.length, 2);
});

test('표 목록이 배열이 아니면 빈 목록에서 시작한다', () => {
  assert.deepStrictEqual(castVote(undefined, 'kim', 'A'), [{ anonId: 'kim', placeId: 'A' }]);
  assert.deepStrictEqual(castVote(null, 'kim', 'A'), [{ anonId: 'kim', placeId: 'A' }]);
});

// 집계: 정상

test('표가 가장 많은 가게로 정해진다', () => {
  const votes = votesOf(['kim', 'A'], ['lee', 'A'], ['park', 'B']);
  const result = tallyVotes(candidates, votes);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.winnerId, 'A');
  assert.deepStrictEqual(result.value.counts, { A: 2, B: 1, C: 0 });
});

test('표가 한 장뿐이어도 그 가게로 정해진다', () => {
  const result = tallyVotes(candidates, votesOf(['kim', 'C']));

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.winnerId, 'C');
});

// 집계: 경계값 (동점)

test('표가 같으면 도보 시간이 짧은 가게로 정해진다', () => {
  // A는 8분, B는 5분
  const votes = votesOf(['kim', 'A'], ['lee', 'B']);
  const result = tallyVotes(candidates, votes);

  assert.strictEqual(result.value.winnerId, 'B');
});

test('표도 같고 도보 시간도 같으면 먼저 후보에 오른 가게로 정해진다', () => {
  // B와 C는 둘 다 5분이고 B가 먼저 후보에 올랐다
  const votes = votesOf(['kim', 'C'], ['lee', 'B']);
  const result = tallyVotes(candidates, votes);

  assert.strictEqual(result.value.winnerId, 'B');
});

test('후보 순서가 바뀌면 같은 표여도 먼저 오른 쪽이 달라진다', () => {
  const reversed = [candidates[2], candidates[1], candidates[0]]; // C, B, A
  const votes = votesOf(['kim', 'C'], ['lee', 'B']);
  const result = tallyVotes(reversed, votes);

  assert.strictEqual(result.value.winnerId, 'C');
});

test('표가 더 많으면 도보 시간이 길어도 그 가게로 정해진다', () => {
  // A는 8분으로 가장 멀지만 두 표
  const votes = votesOf(['kim', 'A'], ['lee', 'A'], ['park', 'B']);
  const result = tallyVotes(candidates, votes);

  assert.strictEqual(result.value.winnerId, 'A');
});

test('세 곳이 모두 동점이면 가장 가깝고 먼저 오른 가게로 정해진다', () => {
  const votes = votesOf(['kim', 'A'], ['lee', 'B'], ['park', 'C']);
  const result = tallyVotes(candidates, votes);

  assert.strictEqual(result.value.winnerId, 'B');
});

test('도보 시간이 없는 후보는 동점일 때 가장 먼 것으로 친다', () => {
  const noWalk = [{ placeId: 'X' }, { placeId: 'Y', walkMinutes: 14 }];
  const votes = votesOf(['kim', 'X'], ['lee', 'Y']);
  const result = tallyVotes(noWalk, votes);

  assert.strictEqual(result.value.winnerId, 'Y');
});

// 집계: 표가 없을 때

test('표가 하나도 없으면 마감할 수 없다', () => {
  const result = tallyVotes(candidates, []);

  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

test('후보에 없는 가게로만 표가 들어왔으면 표가 없는 것으로 본다', () => {
  const result = tallyVotes(candidates, votesOf(['kim', 'Z']));

  assert.strictEqual(result.ok, false);
});

test('후보에 없는 가게로 온 표는 세지 않고 나머지로 정한다', () => {
  const votes = votesOf(['kim', 'Z'], ['lee', 'Z'], ['park', 'C']);
  const result = tallyVotes(candidates, votes);

  assert.strictEqual(result.value.winnerId, 'C');
  assert.deepStrictEqual(result.value.counts, { A: 0, B: 0, C: 1 });
});

// 집계: 잘못된 입력

test('후보가 없거나 배열이 아니면 정할 수 없다', () => {
  assert.strictEqual(tallyVotes([], votesOf(['kim', 'A'])).ok, false);
  assert.strictEqual(tallyVotes(null, votesOf(['kim', 'A'])).ok, false);
  assert.strictEqual(tallyVotes(undefined, []).ok, false);
});

test('표 목록이 배열이 아니면 표가 없는 것으로 본다', () => {
  assert.strictEqual(tallyVotes(candidates, null).ok, false);
  assert.strictEqual(tallyVotes(candidates, '표').ok, false);
});

test('같은 사람의 표가 여러 개 섞여 있어도 마지막 한 표만 센다', () => {
  // castVote를 거치지 않고 잘못 저장된 경우
  const votes = votesOf(['kim', 'A'], ['kim', 'A'], ['kim', 'B'], ['lee', 'A']);
  const result = tallyVotes(candidates, votes);

  assert.deepStrictEqual(result.value.counts, { A: 1, B: 1, C: 0 });
  assert.strictEqual(result.value.winnerId, 'B');
});

test('표 목록에 빈 칸이 섞여 있어도 나머지로 센다', () => {
  const votes = [null, { anonId: 'kim', placeId: 'A' }, undefined];
  const result = tallyVotes(candidates, votes);

  assert.strictEqual(result.value.winnerId, 'A');
});

test('가게 id 자리에 constructor 같은 값이 와도 후보가 아니면 세지 않는다', () => {
  const votes = votesOf(['kim', 'constructor'], ['lee', 'toString'], ['park', 'A']);
  const result = tallyVotes(candidates, votes);

  assert.deepStrictEqual(result.value.counts, { A: 1, B: 0, C: 0 });
  assert.strictEqual(result.value.winnerId, 'A');
});
