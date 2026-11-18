// R7: 같은 익명 ID는 같은 가게에 하루에 한 번만 기록할 수 있다. 하루는 한국 시간 기준 날짜다.
//
// 응답(또 갈래요, 글쎄요)과 한 줄 추천은 따로 센다.
// 그래서 이 파일은 "어떤 목록인지"는 모르고, 부르는 쪽이 넘겨준 목록 안에서만 찾는다.
// 화면이나 서버 없이 테스트할 수 있게 현재 시각(now)도 밖에서 받는다.

// 한국은 UTC보다 9시간 빠르고 서머타임이 없다
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

// 시각을 한국 시간 기준 날짜 "YYYY-MM-DD"로 바꾼다.
// time은 Date, ISO 문자열("2026-11-19T03:20:00.000Z"), 밀리초 숫자 중 하나.
// 시각으로 읽을 수 없으면 null을 돌려준다
function toKoreaDate(time) {
  const ms = new Date(time).getTime();
  if (Number.isNaN(ms)) {
    return null;
  }

  // 9시간을 더한 뒤 UTC 날짜를 읽으면 한국 날짜가 된다
  return new Date(ms + KOREA_OFFSET_MS).toISOString().slice(0, 10);
}

// 기록 목록(records)에 같은 익명 ID가 같은 가게에 오늘(한국 날짜) 남긴 것이 있으면 true.
// records의 각 기록은 { anonId, placeId, createdAt }을 갖고 있어야 한다.
// now는 지금 시각. 저장하기 직전에 이 함수가 true면 저장하지 않는다
function isDuplicateToday(records, anonId, placeId, now) {
  if (!Array.isArray(records)) {
    return false;
  }

  const today = toKoreaDate(now);
  if (today === null) {
    return false;
  }

  for (const record of records) {
    if (!record) {
      continue;
    }
    if (record.anonId !== anonId || record.placeId !== placeId) {
      continue;
    }
    // 시각이 깨진 기록은 날짜를 알 수 없어서 건너뛴다
    if (toKoreaDate(record.createdAt) === today) {
      return true;
    }
  }

  return false;
}

module.exports = {
  toKoreaDate,
  isDuplicateToday,
};
