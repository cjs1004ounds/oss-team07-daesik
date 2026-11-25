// 횟수 제한. 정해진 시간 창 안에서 key마다 몇 번 썼는지 센다.
// LLM을 일부러 많이 부르게 만들어 한도를 바닥내는 것을 막으려고 쓴다 (server/llm.js).
//
// counters는 Map이고 부르는 쪽(서버)이 하나 만들어서 계속 넘겨준다.
// 시각은 밀리초 숫자(Date.now()가 주는 값)다.

// 한 번 쓴다. 남아 있으면 세고 ok: true, 다 썼으면 세지 않고 ok: false.
//   { ok, remaining }  remaining은 이번 것을 뺀 남은 횟수
// 창은 처음 쓴 때부터 windowMs 동안이고, 지나면 새로 센다
function take(counters, key, limit, windowMs, now) {
  if (!Number.isInteger(limit) || limit <= 0) {
    return { ok: false, remaining: 0 };
  }

  let counter = counters.get(key);
  if (!counter || now - counter.startedAt >= windowMs || now < counter.startedAt) {
    counter = { startedAt: now, count: 0 };
    counters.set(key, counter);
  }

  if (counter.count >= limit) {
    return { ok: false, remaining: 0 };
  }
  counter.count += 1;
  return { ok: true, remaining: limit - counter.count };
}

// 오래된 창을 지운다. key가 계속 늘어나 메모리를 차지하지 않게 가끔 부른다
function cleanUp(counters, windowMs, now) {
  for (const [key, counter] of counters) {
    if (now - counter.startedAt >= windowMs) {
      counters.delete(key);
    }
  }
}

// 한국 시간 날짜 문자열 "2026-11-25". 하루 한도를 한국 시간 0시에 새로 세려고 쓴다
function koreaDay(now) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = {
  take,
  cleanUp,
  koreaDay,
};
