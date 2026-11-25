// R16 지금 상황 제보.
// 학생들이 "웨이팅 있어요", "자리 있어요"를 제보하고, 30분 동안만 보여 준다.
//
// 쓰는 값의 모양
//   제보(reports): [{ placeId, kind, anonId, createdAt }]

const KINDS = ['waiting', 'seats'];

// 이 시간이 지난 제보는 보이지 않는다
const LIVE_MINUTES = 30;
const LIVE_MS = LIVE_MINUTES * 60 * 1000;

// 저장해 두는 기간. 지난 제보는 쓸 일이 없어서 하루가 지나면 지운다
const KEEP_MS = 24 * 60 * 60 * 1000;

function isKind(kind) {
  return KINDS.includes(kind);
}

// 제보가 아직 보이는지. 30분이 되는 순간부터는 안 보인다. 미래 시각은 믿지 않는다
function isLive(report, now) {
  const created = new Date(report && report.createdAt).getTime();
  const current = new Date(now).getTime();
  if (Number.isNaN(created) || Number.isNaN(current) || created > current) {
    return false;
  }
  return current - created < LIVE_MS;
}

// 같은 사람이 같은 가게에 30분 안에 이미 제보했는지
function hasRecentReport(reports, placeId, anonId, now) {
  return (Array.isArray(reports) ? reports : []).some(
    (report) => report && report.placeId === placeId && report.anonId === anonId && isLive(report, now)
  );
}

// 가게 하나의 지금 상황. 30분 안 제보가 없으면 null
//   { waiting, seats, latestKind, latestAt }
//   waiting, seats: 종류별 제보 수. 같은 사람은 한 번만 센다
//   latestKind, latestAt: 가장 최근 제보
function summarizeLive(reports, now) {
  const live = (Array.isArray(reports) ? reports : []).filter((report) => report && isKind(report.kind) && isLive(report, now));
  if (live.length === 0) {
    return null;
  }

  const people = { waiting: new Set(), seats: new Set() };
  let latest = null;
  for (const report of live) {
    people[report.kind].add(report.anonId);
    if (latest === null || report.createdAt > latest.createdAt) {
      latest = report;
    }
  }

  return {
    waiting: people.waiting.size,
    seats: people.seats.size,
    latestKind: latest.kind,
    latestAt: latest.createdAt,
  };
}

// 하루가 지난 제보를 뺀 목록
function pruneOld(reports, now) {
  const current = new Date(now).getTime();
  return (Array.isArray(reports) ? reports : []).filter((report) => {
    const created = new Date(report && report.createdAt).getTime();
    return !Number.isNaN(created) && current - created < KEEP_MS;
  });
}

module.exports = {
  KINDS,
  LIVE_MINUTES,
  isKind,
  isLive,
  hasRecentReport,
  summarizeLive,
  pruneOld,
};
