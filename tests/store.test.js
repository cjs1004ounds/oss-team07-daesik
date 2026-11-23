const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 실제 data 폴더를 건드리지 않게, 테스트마다 임시 폴더를 만들어 쓴다
function useTempDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
  process.env.DATA_DIR = path.join(base, 'runtime');
  process.env.SEED_DIR = path.join(base, 'seed');
  return base;
}

const store = require('../server/store');

const samplePlace = {
  id: '100',
  name: '테스트식당',
  lat: 37.62,
  lng: 127.06,
  category: '음식점 > 한식',
};

const sampleReview = {
  placeId: '100',
  text: '제육 7천원인데 양 많음',
  price: 7000,
  tags: ['양 많음'],
  anonId: 'anon-1',
};

test('처음에는 가게가 하나도 없다', () => {
  useTempDirs();
  store.load();

  assert.deepStrictEqual(store.getPlaces(), []);
  assert.strictEqual(store.getPlace('100'), null);
});

test('가게를 추가하면 목록과 하나 조회에서 보인다', () => {
  useTempDirs();
  store.load();

  store.addPlace(samplePlace);

  assert.strictEqual(store.getPlaces().length, 1);
  assert.deepStrictEqual(store.getPlace('100'), samplePlace);
});

test('같은 가게를 두 번 추가해도 하나만 남는다', () => {
  useTempDirs();
  store.load();

  store.addPlace(samplePlace);
  store.addPlace({ ...samplePlace, name: '다른 이름' });

  assert.strictEqual(store.getPlaces().length, 1);
  assert.strictEqual(store.getPlace('100').name, '테스트식당');
});

test('가게에 정해진 필드 말고 다른 값이 있어도 저장하지 않는다', () => {
  useTempDirs();
  store.load();

  store.addPlace({ ...samplePlace, address: '서울 노원구' });

  assert.strictEqual(store.getPlace('100').address, undefined);
});

test('한 줄 추천을 추가하면 id와 createdAt이 붙는다', () => {
  useTempDirs();
  store.load();

  const saved = store.addReview(sampleReview);

  assert.ok(saved.id);
  assert.ok(!Number.isNaN(Date.parse(saved.createdAt)));
  assert.strictEqual(saved.text, sampleReview.text);
});

test('한 줄 추천은 가게별로 나눠서 읽힌다', () => {
  useTempDirs();
  store.load();

  store.addReview(sampleReview);
  store.addReview({ ...sampleReview, placeId: '200' });

  assert.strictEqual(store.getReviewsByPlace('100').length, 1);
  assert.strictEqual(store.getReviewsByPlace('200').length, 1);
  assert.strictEqual(store.getReviewsByPlace('없는 가게').length, 0);
});

test('다시 읽어 와도(서버 재시작) 저장한 것이 남아 있다', () => {
  useTempDirs();
  store.load();
  store.addPlace(samplePlace);
  store.addReview(sampleReview);

  store.load();

  assert.strictEqual(store.getPlaces().length, 1);
  assert.strictEqual(store.getReviewsByPlace('100').length, 1);
});

test('실행 중 파일이 없으면 시드 데이터로 시작한다', () => {
  const base = useTempDirs();
  fs.mkdirSync(path.join(base, 'seed'));
  fs.writeFileSync(path.join(base, 'seed', 'places.json'), JSON.stringify([samplePlace]));

  store.load();

  assert.deepStrictEqual(store.getPlace('100'), samplePlace);
});

test('시드로 시작한 뒤 추가해도 시드에 있던 것이 남는다', () => {
  const base = useTempDirs();
  fs.mkdirSync(path.join(base, 'seed'));
  fs.writeFileSync(path.join(base, 'seed', 'places.json'), JSON.stringify([samplePlace]));
  store.load();

  store.addPlace({ ...samplePlace, id: '200' });
  store.load();

  assert.strictEqual(store.getPlaces().length, 2);
});

test('교내 인증을 저장하면 익명 ID로 읽히고 지금 인증된 것으로 본다', () => {
  useTempDirs();
  store.load();

  assert.strictEqual(store.getVerification('anon-1'), null);
  assert.strictEqual(store.isVerified('anon-1'), false);

  const saved = store.saveVerification('anon-1', 'location');
  assert.strictEqual(saved.method, 'location');
  assert.strictEqual(typeof saved.verifiedAt, 'string');
  assert.deepStrictEqual(store.getVerification('anon-1'), saved);
  assert.strictEqual(store.isVerified('anon-1'), true);
  assert.strictEqual(store.isVerified('anon-2'), false);
});

test('교내 인증은 다시 읽어 와도 남고, 30일이 지나면 인증되지 않은 것으로 본다', () => {
  useTempDirs();
  store.load();

  store.saveVerification('anon-1', 'wifi');
  store.load();

  const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
  assert.strictEqual(store.getVerification('anon-1').method, 'wifi');
  assert.strictEqual(store.isVerified('anon-1', later), false);
});
