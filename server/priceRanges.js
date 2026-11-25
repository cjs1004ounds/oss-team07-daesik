// 가게 종류별 보통 1인 가격 범위 (R17의 세 번째 기준).
// LLM에게 한 번 물어 저장 모듈에 일주일 동안 저장해 둔다. 서버를 다시 켜도 남는다.
// 실패한 종류는 1시간 뒤에 다시 묻는다(이건 메모리에만 둔다).

const llm = require('./llm');
const store = require('./store');
const { buildRangePrompt, parseRange } = require('../shared/priceCheck');

const SUCCESS_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 4000;

// 최근에 실패한 종류 -> 실패한 시각
const failures = new Map();
// 묻는 중인 종류 -> Promise. 같은 종류를 동시에 두 번 묻지 않게
const inProgress = new Map();

// 저장해 둔 범위. 없거나 일주일이 지났으면 null. 기다리지 않는다
function getCachedRange(key) {
  const saved = key ? store.getPriceRange(key) : null;
  if (!saved || Date.now() - new Date(saved.savedAt).getTime() >= SUCCESS_MS) {
    return null;
  }
  return { min: saved.min, max: saved.max };
}

// 범위를 구한다. 저장해 둔 것이 있으면 그것을, 없으면 LLM에게 묻는다. 실패하면 null
async function ensureRange(key, clientKey) {
  if (!key) {
    return null;
  }
  const cached = getCachedRange(key);
  if (cached) {
    return cached;
  }
  if (failures.has(key) && Date.now() - failures.get(key) < FAILURE_MS) {
    return null;
  }

  if (!inProgress.has(key)) {
    const job = (async () => {
      try {
        const result = parseRange(await llm.generateJson(buildRangePrompt(key), { timeoutMs: TIMEOUT_MS, clientKey: clientKey }));
        if (result.ok) {
          store.savePriceRange(key, result.value);
          failures.delete(key);
          return result.value;
        }
        console.error('보통 가격 범위를 쓸 수 없습니다: ' + result.error);
      } catch (err) {
        console.error('보통 가격 범위 실패: ' + err.message);
        // 한도에 걸린 것은 실패로 적지 않아서 다음에 다시 물을 수 있게 한다
        if (err.code === 'LLM_LIMIT') {
          return null;
        }
      }
      failures.set(key, Date.now());
      return null;
    })().finally(() => {
      inProgress.delete(key);
    });
    inProgress.set(key, job);
  }
  return inProgress.get(key);
}

// 테스트에서 실패 기록을 지울 때 쓴다
function resetFailures() {
  failures.clear();
  inProgress.clear();
}

module.exports = {
  getCachedRange,
  ensureRange,
  resetFailures,
};
