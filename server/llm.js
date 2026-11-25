// LLM(Gemini API)을 부르는 파일. 서버에서 LLM을 부르는 곳은 이 파일 하나다.
// 키가 없거나 호출이 실패하면 오류를 던진다. 받는 쪽은 오류가 나도 LLM 없이 계속 동작해야 한다.
// 문서: https://ai.google.dev/api/generate-content

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

// 정식(stable) 모델 중 빠르고 싼 쪽. 바꾸려면 .env의 GEMINI_MODEL에 적는다
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

// 이보다 오래 걸리면 기다리지 않고 실패로 본다. 부르는 쪽에서 options.timeoutMs로 줄일 수 있다
const TIMEOUT_MS = 8000;

// 문장을 보내고 모델이 돌려준 글자를 그대로 돌려준다. JSON으로 답하게 요청한다.
// 돌려받은 글자가 맞는 모양인지는 부르는 쪽에서 검사한다 (예: shared/moderation.js)
async function generateJson(prompt, options = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY가 없습니다.');
  }
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
  generateJson,
};
