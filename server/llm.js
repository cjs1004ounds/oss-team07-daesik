// LLM(Gemini API)을 부르는 파일. 서버에서 LLM을 부르는 곳은 이 파일 하나다.
// 키가 없거나 호출이 실패하면 오류를 던진다. 받는 쪽은 오류가 나도 LLM 없이 계속 동작해야 한다.
// 문서: https://ai.google.dev/api/generate-content

const { take, cleanUp, koreaDay } = require('../shared/usageLimit');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

// 정식(stable) 모델 중 빠르고 싼 쪽. 바꾸려면 .env의 GEMINI_MODEL에 적는다
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

// 이보다 오래 걸리면 기다리지 않고 실패로 본다. 부르는 쪽에서 options.timeoutMs로 줄일 수 있다
const TIMEOUT_MS = 8000;

// 서버 전체에서 하루(한국 시간)에 LLM을 부르는 횟수. .env의 LLM_DAILY_LIMIT로 바꾼다
const DEFAULT_DAILY_LIMIT = 2000;
// 같은 사람(접속 IP)이 1시간에 LLM을 부르게 만들 수 있는 횟수
const PER_CLIENT_LIMIT = 40;
const HOUR_MS = 60 * 60 * 1000;

// 횟수를 세는 곳. 서버를 끄면 사라져도 되는 값이라 파일에 쓰지 않는다
const dailyCounters = new Map();
const clientCounters = new Map();

// 한도를 넘었을 때 던지는 오류. 받는 쪽은 다른 실패와 똑같이 LLM 없이 동작하면 된다
function limitError(message) {
  const err = new Error(message);
  err.code = 'LLM_LIMIT';
  return err;
}

// 부르기 전에 한도를 센다. 사람별 한도를 먼저 보고, 그다음 하루 한도를 센다
function checkLimits(clientKey, now) {
  if (clientKey) {
    cleanUp(clientCounters, HOUR_MS, now);
    if (!take(clientCounters, clientKey, PER_CLIENT_LIMIT, HOUR_MS, now).ok) {
      throw limitError('LLM 사람별 한도를 넘었습니다.');
    }
  }

  const dailyLimit = Number(process.env.LLM_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const day = koreaDay(now);
  for (const savedDay of dailyCounters.keys()) {
    if (savedDay !== day) {
      dailyCounters.delete(savedDay);
    }
  }
  // 창은 하루보다 길게 잡고 날짜를 key로 써서, 한국 시간 0시에 새 key로 다시 센다
  if (!take(dailyCounters, day, dailyLimit, 2 * 24 * HOUR_MS, now).ok) {
    throw limitError('LLM 하루 한도를 넘었습니다.');
  }
}

// 테스트에서 횟수를 처음으로 되돌릴 때 쓴다
function resetLimits() {
  dailyCounters.clear();
  clientCounters.clear();
}

// 문장을 보내고 모델이 돌려준 글자를 그대로 돌려준다. JSON으로 답하게 요청한다.
// 돌려받은 글자가 맞는 모양인지는 부르는 쪽에서 검사한다 (예: shared/moderation.js)
//   options.timeoutMs  기다리는 시간
//   options.clientKey  누가 부르게 만들었는지 (접속 IP). 주면 사람별 한도를 센다
async function generateJson(prompt, options = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY가 없습니다.');
  }
  checkLimits(options.clientKey, Date.now());
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const res = await fetch(GEMINI_BASE_URL + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 키는 주소(?key=)가 아니라 헤더로 보낸다. 주소에 넣으면 로그에 남을 수 있다
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        // 같은 글에는 늘 비슷하게 답하도록 무작위성을 끈다
        temperature: 0,
      },
    }),
    signal: AbortSignal.timeout(options.timeoutMs || TIMEOUT_MS),
  });

  if (!res.ok) {
    // 응답 본문에는 요청 내용이 섞여 있을 수 있어서 상태 코드만 남긴다
    throw new Error('Gemini 호출 실패 (' + res.status + ')');
  }

  const data = await res.json();
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
  if (text === '') {
    throw new Error('Gemini 응답에 글자가 없습니다.');
  }
  return text;
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_DAILY_LIMIT,
  PER_CLIENT_LIMIT,
  generateJson,
  resetLimits,
};
