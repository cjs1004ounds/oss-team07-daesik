// 저장 모듈. 가게, 한 줄 추천, 교내 인증, 다녀왔어요 응답, 같이 정하기 방, 신고, 지금 상황 제보를 JSON 파일에 읽고 쓴다.
// 파일을 직접 여는 코드는 이 파일에만 둔다.
// 나중에 저장 방식을 바꾸게 되면(예: 호스팅이 파일을 지우는 경우) 이 파일만 고치면 된다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { isVerificationActive } = require('../shared/campusVerify');
const { pruneOld } = require('../shared/liveStatus');

// 켤 때 파일에서 읽어 와 여기에 들고 있다가, 추가할 때마다 파일에 다시 쓴다
let places = null;
let reviews = null;
let verifications = null;
let visits = null;
let rooms = null;
let reports = null;
let statuses = null;

// 실행 중에 쓰는 파일이 있는 폴더. 테스트에서는 DATA_DIR로 임시 폴더를 가리킨다
function getDataDir() {
  return process.env.DATA_DIR || path.join(__dirname, '..', 'data', 'runtime');
}

// 저장소에 포함된 시드 데이터 폴더
function getSeedDir() {
  return process.env.SEED_DIR || path.join(__dirname, '..', 'data', 'seed');
}

// 파일 하나를 읽어 배열로 돌려준다.
// 실행 중 파일이 없으면 시드를 쓰고, 시드도 없으면 빈 배열로 시작한다
function readList(fileName) {
  const dataFile = path.join(getDataDir(), fileName);
  if (fs.existsSync(dataFile)) {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  }

  const seedFile = path.join(getSeedDir(), fileName);
  if (fs.existsSync(seedFile)) {
    return JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  }

  return [];
}

// 배열 전체를 파일에 다시 쓴다
function writeList(fileName, list) {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(path.join(getDataDir(), fileName), JSON.stringify(list, null, 2));
}

// 파일에서 데이터를 읽어 온다. 서버를 켤 때 한 번 부른다
function load() {
  places = readList('places.json');
  reviews = readList('reviews.json');
  verifications = readList('verifications.json');
  visits = readList('visits.json');
  rooms = readList('rooms.json');
  reports = readList('reports.json');
  statuses = readList('statuses.json');
}

// load()를 안 부르고 쓰더라도 동작하게 한다
function ensureLoaded() {
  if (places === null || reviews === null || verifications === null || visits === null || rooms === null || reports === null || statuses === null) {
    load();
  }
}

// 기록이 있는 가게 전부
function getPlaces() {
  ensureLoaded();
  return places.slice();
}

// 가게 하나. 없으면 null
function getPlace(id) {
  ensureLoaded();
  const found = places.find((place) => place.id === id);
  return found || null;
}

// 가게를 추가한다. 이미 있는 가게면 그대로 두고 있던 것을 돌려준다
function addPlace(place) {
  ensureLoaded();

  const existing = getPlace(place.id);
  if (existing) {
    return existing;
  }

  const newPlace = {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
  };
  places.push(newPlace);
  writeList('places.json', places);
  return newPlace;
}

// 한 줄 추천 전부. 기록에 적힌 메뉴로 가게를 찾을 때 쓴다
function getReviews() {
  ensureLoaded();
  return reviews.slice();
}

// 한 가게의 한 줄 추천 전부
function getReviewsByPlace(placeId) {
  ensureLoaded();
  return reviews.filter((review) => review.placeId === placeId);
}

// 한 줄 추천을 추가한다. id와 createdAt은 여기서 붙인다.
// 값이 올바른지(R6)는 부르는 쪽에서 먼저 검사한다
function addReview(review) {
  ensureLoaded();

  const newReview = {
    id: crypto.randomUUID(),
    placeId: review.placeId,
    text: review.text,
    price: review.price,
    tags: review.tags,
    anonId: review.anonId,
    verified: isVerified(review.anonId),
    createdAt: new Date().toISOString(),
  };
  reviews.push(newReview);
  writeList('reviews.json', reviews);
  return newReview;
}

// 익명 ID 하나의 교내 인증 기록. 없으면 null
function getVerification(anonId) {
  ensureLoaded();
  const found = verifications.find((verification) => verification.anonId === anonId);
  return found || null;
}

// 교내 인증을 저장한다. 같은 익명 ID가 다시 인증하면 시각과 방법을 새로 바꾼다.
// 좌표와 IP는 받지도 않고 저장하지도 않는다 (README "개인정보")
function saveVerification(anonId, method) {
  ensureLoaded();

  const verification = {
    anonId: anonId,
    method: method,
    verifiedAt: new Date().toISOString(),
  };

  const index = verifications.findIndex((item) => item.anonId === anonId);
  if (index === -1) {
    verifications.push(verification);
  } else {
    verifications[index] = verification;
  }
  writeList('verifications.json', verifications);
  return verification;
}

// 이 익명 ID가 지금 교내 인증돼 있는지 (R13).
// 기록을 저장할 때 인증 여부를 붙이거나, 비율에 인증된 기록만 넣을 때 쓴다
function isVerified(anonId, now) {
  return isVerificationActive(getVerification(anonId), now || new Date());
}

// 다녀왔어요 응답 전부
function getVisits() {
  ensureLoaded();
  return visits.slice();
}

// 한 가게의 다녀왔어요 응답 전부
function getVisitsByPlace(placeId) {
  ensureLoaded();
  return visits.filter((visit) => visit.placeId === placeId);
}

// 다녀왔어요("또 갈래요" / "글쎄요") 응답을 추가한다.
// 저장할 때 교내 인증 상태(verified)를 함께 기록해 비율 계산(R14)에 쓴다
function addVisit(visit) {
  ensureLoaded();

  const newVisit = {
    id: crypto.randomUUID(),
    placeId: visit.placeId,
    again: visit.again,
    anonId: visit.anonId,
    roomCode: visit.roomCode || null,
    verified: isVerified(visit.anonId),
    createdAt: new Date().toISOString(),
  };
  visits.push(newVisit);
  writeList('visits.json', visits);
  return newVisit;
}

// 같이 정하기 방 하나. 없으면 null.
// 돌려준 값을 고쳐도 저장된 방은 바뀌지 않는다. 바꾸려면 updateRoom을 부른다
function getRoom(code) {
  ensureLoaded();
  const found = rooms.find((room) => room.code === code);
  return found ? structuredClone(found) : null;
}

// 방을 추가한다. 방 코드가 겹치지 않는지는 부르는 쪽에서 getRoom으로 먼저 본다
function addRoom(room) {
  ensureLoaded();

  const newRoom = {
    code: room.code,
    candidates: room.candidates,
    votes: [],
    closed: false,
    winnerId: null,
    ownerAnonId: room.ownerAnonId,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
  rooms.push(newRoom);
  writeList('rooms.json', rooms);
  return structuredClone(newRoom);
}

// 방의 표, 마감 여부, 정해진 가게를 바꿔 저장한다. 없는 방이면 null
function updateRoom(code, changes) {
  ensureLoaded();

  const index = rooms.findIndex((room) => room.code === code);
  if (index === -1) {
    return null;
  }

  const room = rooms[index];
  if (changes.votes !== undefined) {
    room.votes = changes.votes;
  }
  if (changes.closed !== undefined) {
    room.closed = changes.closed;
    room.closedAt = changes.closed ? new Date().toISOString() : null;
  }
  if (changes.winnerId !== undefined) {
    room.winnerId = changes.winnerId;
  }
  writeList('rooms.json', rooms);
  return structuredClone(room);
}

// 가게에 LLM 요약을 적어 둔다. key는 어떤 추천들로 만든 요약인지 알아보는 표시다
function setPlaceSummary(placeId, summary) {
  ensureLoaded();
  const place = places.find((item) => item.id === placeId);
  if (!place) {
    return null;
  }
  place.summary = {
    text: summary.text,
    key: summary.key,
    createdAt: new Date().toISOString(),
  };
  writeList('places.json', places);
  return place;
}

// 한 줄 추천 하나. 없으면 null
function getReview(id) {
  ensureLoaded();
  const found = reviews.find((review) => review.id === id);
  return found || null;
}

// 한 줄 추천에 LLM 판단 결과를 적어 둔다. 글마다 한 번만 물어보려고 저장한다
function setReviewModeration(id, moderation) {
  ensureLoaded();
  const review = reviews.find((item) => item.id === id);
  if (!review) {
    return null;
  }
  review.moderation = {
    verdict: moderation.verdict,
    reason: moderation.reason,
    checkedAt: new Date().toISOString(),
  };
  writeList('reviews.json', reviews);
  return review;
}

// 한 줄 추천을 숨긴다 (R15). 지우지 않고 표시만 해 둬서 나중에 되돌릴 수 있다.
// reason은 'reports'(신고 수) 또는 'llm'(LLM 판단)
function hideReview(id, reason) {
  ensureLoaded();
  const review = reviews.find((item) => item.id === id);
  if (!review) {
    return null;
  }
  review.hidden = true;
  review.hiddenReason = reason;
  review.hiddenAt = new Date().toISOString();
  writeList('reviews.json', reviews);
  return review;
}

// 한 줄 추천 하나에 들어온 신고 전부
function getReportsByReview(reviewId) {
  ensureLoaded();
  return reports.filter((report) => report.reviewId === reviewId);
}

// 신고를 추가한다. 신고할 때의 교내 인증 상태(verified)를 같이 적어 둔다 (R15)
function addReport(report) {
  ensureLoaded();

  const newReport = {
    id: crypto.randomUUID(),
    reviewId: report.reviewId,
    anonId: report.anonId,
    verified: isVerified(report.anonId),
    createdAt: new Date().toISOString(),
  };
  reports.push(newReport);
  writeList('reports.json', reports);
  return newReport;
}

// 가게 하나의 지금 상황 제보 전부 (R16)
function getStatusesByPlace(placeId) {
  ensureLoaded();
  return statuses.filter((status) => status.placeId === placeId);
}

// 지금 상황 제보를 추가한다. 하루가 지난 제보는 이때 지운다
function addStatus(status) {
  ensureLoaded();

  const newStatus = {
    id: crypto.randomUUID(),
    placeId: status.placeId,
    kind: status.kind,
    anonId: status.anonId,
    createdAt: new Date().toISOString(),
  };
  statuses = pruneOld(statuses, Date.now());
  statuses.push(newStatus);
  writeList('statuses.json', statuses);
  return newStatus;
}

module.exports = {
  load,
  getPlaces,
  getPlace,
  addPlace,
  getReviews,
  getReviewsByPlace,
  addReview,
  getVerification,
  saveVerification,
  isVerified,
  getVisits,
  getVisitsByPlace,
  addVisit,
  getRoom,
  addRoom,
  updateRoom,
  setPlaceSummary,
  getReview,
  setReviewModeration,
  hideReview,
  getReportsByReview,
  addReport,
  getStatusesByPlace,
  addStatus,
};
