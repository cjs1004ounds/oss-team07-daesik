// R18 기록 칭호.
// 기록을 꾸준히 남긴 사람에게 칭호를 준다.
//
// 세는 기록
//   - 교내 인증 상태에서 남긴 한 줄 추천과 다녀왔어요(verified가 true인 것)만
//   - 신고로 숨겨진 한 줄 추천은 뺀다
//   - 같은 가게에 같은 날(한국 시간) 남긴 한 줄 추천과 다녀왔어요는 한 번으로 센다
//
// 쓰는 값의 모양
//   한 줄 추천(reviews): [{ anonId, placeId, verified, hidden, createdAt }]
//   다녀왔어요(visits):  [{ anonId, placeId, verified, createdAt }]

// 기록 수가 min 이상이면 그 칭호. 큰 것부터 적는다
const TITLES = [
  { min: 30, name: '대식가' },
  { min: 15, name: '맛잘알' },
  { min: 5, name: '단골' },
  { min: 1, name: '첫 숟갈' },
];

// 한국 시간 날짜 "2026-11-25". 시각이 잘못됐으면 빈 문자열
function koreaDate(createdAt) {
  const time = new Date(createdAt).getTime();
  if (Number.isNaN(time)) {
    return '';
  }
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 익명 ID마다 기록 수와 가게 수를 센다. Map(익명 ID -> { recordCount, placeCount })
function countRecordsByPerson(reviews, visits) {
  // 익명 ID -> { days: Set("가게|날짜"), places: Set(가게) }
  const people = new Map();
  const add = (record) => {
    if (!record || record.verified !== true || record.hidden) {
      return;
    }
    if (typeof record.anonId !== 'string' || typeof record.placeId !== 'string') {
      return;
    }
    const day = koreaDate(record.createdAt);
    if (day === '') {
      return;
    }
    const person = people.get(record.anonId) || { days: new Set(), places: new Set() };
    person.days.add(record.placeId + '|' + day);
    person.places.add(record.placeId);
    people.set(record.anonId, person);
  };

  for (const review of Array.isArray(reviews) ? reviews : []) {
    add(review);
  }
  for (const visit of Array.isArray(visits) ? visits : []) {
    add(visit);
  }

  const counts = new Map();
  for (const [anonId, person] of people) {
    counts.set(anonId, { recordCount: person.days.size, placeCount: person.places.size });
  }
  return counts;
}

// 기록 수에 맞는 칭호와 다음 칭호.
//   { title, nextTitle, remaining }
//   title: 지금 칭호. 기록이 없으면 null
//   nextTitle, remaining: 다음 칭호와 거기까지 남은 기록 수. 가장 높은 칭호면 둘 다 null
function titleFor(recordCount) {
  const count = Number.isInteger(recordCount) && recordCount > 0 ? recordCount : 0;

  let title = null;
  let next = null;
  for (const item of TITLES) {
    if (count >= item.min) {
      title = item.name;
      break;
    }
    next = item;
  }

  return {
    title: title,
    nextTitle: next ? next.name : null,
    remaining: next ? next.min - count : null,
  };
}

module.exports = {
  TITLES,
  countRecordsByPerson,
  titleFor,
};
