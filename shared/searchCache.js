// R9: 같은 검색어는 10분 동안 저장해 둔 결과를 쓴다.
//
// 화면이나 서버와 상관없이 테스트할 수 있게, 현재 시각(now)을 밖에서 받는다.
// cache는 Map이고 부르는 쪽(서버)이 하나 만들어서 계속 넘겨준다.
// 시각은 전부 밀리초 숫자(Date.now()가 주는 값)다.

const CACHE_MINUTES = 10;
const CACHE_MS = CACHE_MINUTES * 60 * 1000;

// "같은 검색어"인지 비교할 때 쓰는 모양으로 바꾼다.
// 앞뒤 공백을 떼고, 중간 공백 여러 개는 하나로, 영문은 소문자로.
// 문자열이 아니면 빈 문자열을 돌려준다
function normalizeQuery(query) {
  if (typeof query !== 'string') {
    return '';
  }
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

// 저장한 지 10분이 안 됐으면 true. 정확히 10분이 되면 만료로 본다
function isFresh(savedAt, now) {
  const age = now - savedAt;
  return age >= 0 && age < CACHE_MS;
}

// 저장해 둔 결과가 있고 아직 10분이 안 됐으면 그 결과를, 아니면 null을 돌려준다
function getCached(cache, query, now) {
  const key = normalizeQuery(query);
  if (key === '') {
    return null;
  }

  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (!isFresh(entry.savedAt, now)) {
    cache.delete(key);
    return null;
  }

  return entry.results;
}

// 검색 결과를 저장한다. 빈 검색어는 저장하지 않는다.
// 저장할 때마다 10분 지난 것들을 지워서 메모리에 계속 쌓이지 않게 한다
function setCached(cache, query, results, now) {
  const key = normalizeQuery(query);
  if (key === '') {
    return;
  }

  for (const [savedKey, entry] of cache) {
    if (!isFresh(entry.savedAt, now)) {
      cache.delete(savedKey);
    }
  }

  cache.set(key, { results: results, savedAt: now });
}

module.exports = {
  CACHE_MINUTES,
  normalizeQuery,
  isFresh,
  getCached,
  setCached,
};
