// 익명 ID. 로그인이 없어서 브라우저마다 무작위 ID를 하나 만들어 쓴다 (docs/api.md "익명 ID").
// 한 줄 추천, 다녀왔어요, 투표, 교내 인증, 신고가 모두 같은 값을 쓴다.
// 이 파일은 다른 화면 스크립트보다 먼저 불러야 한다.

// localStorage에서 익명 ID를 가져오고, 처음이면 만들어서 저장한다
function getOrCreateAnonId() {
  let anonId = localStorage.getItem('anonId');
  if (!anonId) {
    // https나 localhost에서는 표준 UUID를 쓰고, 그 함수가 없는 환경에서는 시각과 난수를 이어 붙인다
    anonId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'anon-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('anonId', anonId);
  }
  return anonId;
}
