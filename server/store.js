// 저장 모듈. 가게와 한 줄 추천을 JSON 파일에 읽고 쓴다.
// 파일을 직접 여는 코드는 이 파일에만 둔다.
// 나중에 저장 방식을 바꾸게 되면(예: 호스팅이 파일을 지우는 경우) 이 파일만 고치면 된다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 켤 때 파일에서 읽어 와 여기에 들고 있다가, 추가할 때마다 파일에 다시 쓴다
let places = null;
let reviews = null;

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
}

// load()를 안 부르고 쓰더라도 동작하게 한다
function ensureLoaded() {
  if (places === null || reviews === null) {
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
    createdAt: new Date().toISOString(),
  };
  reviews.push(newReview);
  writeList('reviews.json', reviews);
  return newReview;
}

module.exports = {
  load,
  getPlaces,
  getPlace,
  addPlace,
  getReviewsByPlace,
  addReview,
};
