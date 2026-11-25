const test = require('node:test');
const assert = require('node:assert');

const { REPORTS_TO_HIDE, hasReported, countVerifiedReporters, decideHide } = require('../shared/reportRules');

function report(anonId, verified) {
  return { reviewId: 'r1', anonId: anonId, verified: verified };
}

test('같은 사람이 같은 글을 신고했는지 안다', () => {
  const reports = [report('a', true)];
  assert.strictEqual(hasReported(reports, 'r1', 'a'), true);
  assert.strictEqual(hasReported(reports, 'r1', 'b'), false);
  assert.strictEqual(hasReported(reports, 'r2', 'a'), false);
  assert.strictEqual(hasReported(undefined, 'r1', 'a'), false);
});

test('교내 인증한 서로 다른 신고자만 센다', () => {
  const reports = [report('a', true), report('a', true), report('b', true), report('c', false), null];
  assert.strictEqual(countVerifiedReporters(reports), 2);
  assert.strictEqual(countVerifiedReporters('신고'), 0);
});

test(`교내 인증한 ${REPORTS_TO_HIDE}명이 신고하면 숨긴다`, () => {
  const reports = [report('a', true), report('b', true), report('c', true)];
  assert.deepStrictEqual(decideHide(reports, null), { hide: true, reason: 'reports' });
});

test('인증한 신고자가 2명이면 아직 숨기지 않는다', () => {
  const reports = [report('a', true), report('b', true)];
  assert.deepStrictEqual(decideHide(reports, null), { hide: false, reason: null });
});

test('인증하지 않은 신고는 아무리 많아도 신고 수로는 숨기지 않는다', () => {
  const reports = [report('a', false), report('b', false), report('c', false), report('d', false)];
  assert.strictEqual(decideHide(reports, { verdict: 'ok', reason: '' }).hide, false);
});

test('신고가 1건이라도 있고 LLM이 악의적이라고 하면 숨긴다', () => {
  const result = decideHide([report('a', false)], { verdict: 'malicious', reason: '욕설' });
  assert.deepStrictEqual(result, { hide: true, reason: 'llm' });
});

test('LLM이 정상이나 모르겠다고 하면 신고 수로만 정한다', () => {
  assert.strictEqual(decideHide([report('a', true)], { verdict: 'ok', reason: '' }).hide, false);
  assert.strictEqual(decideHide([report('a', true)], { verdict: 'unsure', reason: '' }).hide, false);
});

test('신고가 없으면 LLM이 악의적이라고 해도 숨기지 않는다', () => {
  assert.strictEqual(decideHide([], { verdict: 'malicious', reason: '욕설' }).hide, false);
  assert.strictEqual(decideHide(undefined, { verdict: 'malicious', reason: '욕설' }).hide, false);
});

test('신고 수로 숨길 수 있으면 LLM 판단보다 신고 수를 이유로 적는다', () => {
  const reports = [report('a', true), report('b', true), report('c', true)];
  assert.strictEqual(decideHide(reports, { verdict: 'malicious', reason: '' }).reason, 'reports');
});
