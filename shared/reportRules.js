// R15 신고와 숨김.
// 교내 인증한 서로 다른 사람 3명이 신고하면 숨긴다.
// 신고가 1건이라도 있고 LLM이 악의적인 글이라고 판단했으면 바로 숨긴다.
// LLM 판단이 없으면(키가 없거나 호출 실패) 신고 수로만 정한다.
//
// 쓰는 값의 모양
//   신고(reports):   [{ reviewId, anonId, verified }]  verified는 신고할 때 교내 인증 상태
//   판단(moderation): { verdict: 'malicious' | 'ok' | 'unsure', reason } 또는 null

const REPORTS_TO_HIDE = 3;

// 같은 사람이 같은 글을 이미 신고했는지
function hasReported(reports, reviewId, anonId) {
  if (!Array.isArray(reports)) {
    return false;
  }
  return reports.some((report) => report && report.reviewId === reviewId && report.anonId === anonId);
}

// 교내 인증한 상태로 신고한 서로 다른 사람 수.
// 같은 사람이 여러 번 들어 있어도 한 명으로 센다
function countVerifiedReporters(reports) {
  if (!Array.isArray(reports)) {
    return 0;
  }
  const people = new Set();
  for (const report of reports) {
    if (report && report.verified === true && typeof report.anonId === 'string') {
      people.add(report.anonId);
    }
  }
  return people.size;
}

// 숨길지 정한다.
//   숨기면     { hide: true, reason: 'reports' | 'llm' }
//   아니면     { hide: false, reason: null }
function decideHide(reports, moderation) {
  const list = Array.isArray(reports) ? reports.filter(Boolean) : [];

  if (countVerifiedReporters(list) >= REPORTS_TO_HIDE) {
    return { hide: true, reason: 'reports' };
  }

  // LLM 판단은 신고가 있을 때만 쓴다. 신고 없이 LLM만으로는 숨기지 않는다
  if (list.length > 0 && moderation && moderation.verdict === 'malicious') {
    return { hide: true, reason: 'llm' };
  }

  return { hide: false, reason: null };
}

module.exports = {
  REPORTS_TO_HIDE,
  hasReported,
  countVerifiedReporters,
  decideHide,
};
