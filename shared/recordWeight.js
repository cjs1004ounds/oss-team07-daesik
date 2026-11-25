// R14 기록 시간 가중치.
// 최근 기록일수록 크게 반영한다. 1년 전 기록과 어제 기록이 같은 무게로 들어가지 않게 하려는 것이다.
//
//   무게 = 0.5 ^ (지난 날수 / 90)   오늘 1, 90일 전 0.5, 180일 전 0.25. 365일이 지나면 0
//
// "또 갈래요" 비율(R4)과 1인 가격 평균(R3)에 이 무게를 쓴다.
//
// 쓰는 값의 모양
//   응답(visits):        [{ again, verified, createdAt }]
//   한 줄 추천(reviews):  [{ price, hidden, createdAt }]

// 무게가 반으로 줄어드는 날수
const HALF_LIFE_DAYS = 90;
// 이 날수가 지난 기록은 넣지 않는다
const MAX_AGE_DAYS = 365;
// 비율을 보여 주려면 있어야 하는 교내 인증 응답 수 (R4)
const MIN_RESPONSES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

// 기록 하나의 무게. 0~1
function recordWeight(createdAt, now) {
  const created = new Date(createdAt).getTime();
  const current = new Date(now).getTime();
  if (Number.isNaN(created) || Number.isNaN(current)) {
    return 0;
  }

  // 시계가 어긋나 미래 시각으로 저장된 기록은 오늘 기록으로 본다
  const ageDays = Math.max(0, (current - created) / DAY_MS);
  if (ageDays >= MAX_AGE_DAYS) {
    return 0;
  }
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

// "또 갈래요" 비율. 교내 인증된 응답만 쓴다 (R14).
//   { responseCount, againRatio }
//   responseCount: 넣은 응답 수 (교내 인증 + 365일 안)
//   againRatio:    0~100 정수. 응답이 3개보다 적으면 null ("기록 부족")
function againStats(visits, now) {
  const used = [];
  for (const visit of Array.isArray(visits) ? visits : []) {
    if (!visit || visit.verified !== true || typeof visit.again !== 'boolean') {
      continue;
    }
    const weight = recordWeight(visit.createdAt, now);
    if (weight > 0) {
      used.push({ again: visit.again, weight: weight });
    }
  }

  if (used.length < MIN_RESPONSES) {
    return { responseCount: used.length, againRatio: null };
  }

  let againWeight = 0;
  let totalWeight = 0;
  for (const item of used) {
    totalWeight += item.weight;
    if (item.again) {
      againWeight += item.weight;
    }
  }
  return { responseCount: used.length, againRatio: Math.round((againWeight / totalWeight) * 100) };
}

// 1인 가격 평균 (R3). 가격이 적힌 한 줄 추천에 무게를 곱해 평균을 내고 100원 단위로 반올림한다.
// 숨긴 글(R15)은 빼고, 가격이 하나도 없으면 null
function averagePrice(reviews, now) {
  let sum = 0;
  let totalWeight = 0;
  for (const review of Array.isArray(reviews) ? reviews : []) {
    if (!review || review.hidden || typeof review.price !== 'number' || !Number.isFinite(review.price)) {
      continue;
    }
    const weight = recordWeight(review.createdAt, now);
    sum += review.price * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return null;
  }
  return Math.round(sum / totalWeight / 100) * 100;
}

// 가장 최근 기록의 시각. 숨긴 글은 빼고, 기록이 없으면 null
function lastRecordAt(records) {
  let latest = null;
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.hidden || typeof record.createdAt !== 'string') {
      continue;
    }
    if (Number.isNaN(new Date(record.createdAt).getTime())) {
      continue;
    }
    if (latest === null || record.createdAt > latest) {
      latest = record.createdAt;
    }
  }
  return latest;
}

module.exports = {
  HALF_LIFE_DAYS,
  MAX_AGE_DAYS,
  MIN_RESPONSES,
  recordWeight,
  againStats,
  averagePrice,
  lastRecordAt,
};
