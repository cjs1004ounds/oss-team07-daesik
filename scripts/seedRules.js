// 시드 데이터를 만들 때 쓰는 규칙. 파일을 읽거나 카카오를 부르는 일은 scripts/buildSeed.js가 하고,
// 여기에는 입력 검사와 변환만 함수로 둔다 (docs/seed.md).

const crypto = require('crypto');

const { validateReviewInput, validateMenu } = require('../shared/reviewValidator');

const MAX_WRITER_LENGTH = 20;
const MAX_PLACE_NAME_LENGTH = 50;

// 띄어쓰기를 지우고 소문자로. 가게 이름을 비교할 때 쓴다
function compact(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, '').toLowerCase() : '';
}

// "2026-11-20" 같은 날짜인지 보고, 그날 한국 시간 낮 12시를 ISO 글자로 돌려준다. 아니면 null.
// 없는 날짜(2월 30일)와 오늘보다 뒤의 날짜는 받지 않는다. now는 지금 시각(ms)
function seedDate(date, now) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  // 한국 시간 낮 12시는 UTC로 3시다
  const time = Date.parse(date + 'T03:00:00.000Z');
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    return null;
  }
  if (time > now) {
    return null;
  }
  return new Date(time).toISOString();
}

// 쓴 사람 이름표를 익명 ID로 바꾼다. 같은 이름표는 늘 같은 ID가 된다.
// 이름표를 그대로 저장하지 않으려고 해시의 앞 12자만 쓴다
function seedAnonId(writer) {
  const hash = crypto.createHash('sha256').update('daesik-seed:' + String(writer).trim()).digest('hex');
  return 'seed-' + hash.slice(0, 12);
}

// 입력 한 줄을 검사한다. number는 안내 문구에 쓸 순서(1부터).
//   통과하면 { ok: true, value: { place, placeId, text, price, tags, menu, again, createdAt, writer } }
//   아니면   { ok: false, error: '3번째: 이유' }
// 한 줄 추천(text)과 다녀왔어요(again) 중 하나는 있어야 한다. 한 줄 추천은 R6 검사를 그대로 쓴다
function validateItem(item, number, now) {
  const fail = (reason) => ({ ok: false, error: number + '번째: ' + reason });

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return fail('모양이 올바르지 않습니다.');
  }

  const place = typeof item.place === 'string' ? item.place.trim() : '';
  if (place === '' || place.length > MAX_PLACE_NAME_LENGTH) {
    return fail('가게 이름(place)을 ' + MAX_PLACE_NAME_LENGTH + '자 안으로 적어 주세요.');
  }

  let placeId = null;
  if (item.placeId !== undefined && item.placeId !== null) {
    if (typeof item.placeId !== 'string' || item.placeId.trim() === '') {
      return fail('가게 번호(placeId)는 글자로 적어 주세요.');
    }
    placeId = item.placeId.trim();
  }

  const writer = typeof item.writer === 'string' ? item.writer.trim() : '';
  if (writer === '' || writer.length > MAX_WRITER_LENGTH) {
    return fail('쓴 사람 이름표(writer)를 ' + MAX_WRITER_LENGTH + '자 안으로 적어 주세요.');
  }

  const createdAt = seedDate(item.date, now);
  if (!createdAt) {
    return fail('날짜(date)는 2026-11-20 같은 모양이고 오늘까지여야 합니다.');
  }

  let again = null;
  if (item.again !== undefined && item.again !== null) {
    if (typeof item.again !== 'boolean') {
      return fail('또 갈래요 여부(again)는 true 또는 false여야 합니다.');
    }
    again = item.again;
  }

  const hasText = typeof item.text === 'string' && item.text.trim() !== '';
  if (!hasText && again === null) {
    return fail('한 줄 추천(text)이나 또 갈래요 여부(again) 중 하나는 있어야 합니다.');
  }

  let text = null;
  let price = null;
  let tags = [];
  let menu = null;
  if (hasText) {
    const review = validateReviewInput({ text: item.text, price: item.price, tags: item.tags });
    if (!review.ok) {
      return fail(review.error);
    }
    const checkedMenu = validateMenu(item.menu);
    if (!checkedMenu.ok) {
      return fail(checkedMenu.error);
    }
    text = review.value.text;
    price = review.value.price;
    tags = review.value.tags;
    menu = checkedMenu.value;
  }

  return {
    ok: true,
    value: { place, placeId, text, price, tags, menu, again, createdAt, writer },
  };
}

// 같은 사람이 같은 가게에 같은 날 두 번 적었는지 찾는다 (R7과 같은 기준).
// 겹친 줄의 안내 문구 목록을 돌려준다. 없으면 빈 배열. items는 validateItem을 통과한 값이다
function findDuplicates(items) {
  const firstSeen = new Map();
  const errors = [];
  items.forEach((item, index) => {
    const key = item.writer + '|' + compact(item.place) + '|' + item.createdAt;
    if (firstSeen.has(key)) {
      errors.push(index + 1 + '번째: ' + firstSeen.get(key) + '번째와 쓴 사람, 가게, 날짜가 같습니다. 하루에 한 번만 적을 수 있습니다.');
    } else {
      firstSeen.set(key, index + 1);
    }
  });
  return errors;
}

// 카카오가 찾아 준 가게들 중에서 입력에 적은 가게를 고른다.
//   통과하면 { ok: true, place }
//   아니면   { ok: false, error: '이유' }
// placeId를 적었으면 그 번호의 가게를, 아니면 이름이 똑같은 가게를 고른다.
// 이름이 똑같은 가게가 없을 때는 후보가 하나이고 그 이름에 입력한 이름이 들어 있으면 그 가게로 본다
function choosePlace(name, placeId, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const describe = () => list.map((place) => place.name + ' (placeId ' + place.id + ', ' + (place.address || '주소 없음') + ')').join(' / ');

  if (placeId) {
    const found = list.find((place) => String(place.id) === placeId);
    return found ? { ok: true, place: found } : { ok: false, error: '"' + name + '"의 placeId ' + placeId + '를 검색 결과에서 찾지 못했습니다.' };
  }

  if (list.length === 0) {
    return { ok: false, error: '"' + name + '"를 학교 근처에서 찾지 못했습니다. 카카오맵에 적힌 이름으로 적어 주세요.' };
  }

  const target = compact(name);
  const exact = list.filter((place) => compact(place.name) === target);
  if (exact.length === 1) {
    return { ok: true, place: exact[0] };
  }
  if (exact.length === 0 && list.length === 1 && compact(list[0].name).includes(target)) {
    return { ok: true, place: list[0] };
  }
  return { ok: false, error: '"' + name + '"가 어느 가게인지 정하지 못했습니다. placeId를 적어 주세요. 후보: ' + describe() };
}

// 검사한 입력과 고른 가게로 시드 파일 세 개의 내용을 만든다.
// placeOf는 입력 한 줄을 받아 그 줄의 가게를 돌려주는 함수다.
// 교내 인증(verified)은 true로 넣는다. 시드는 팀원이 직접 다녀온 기록만 넣기로 했고(#14),
// 인증되지 않은 응답은 또 갈래요 비율(R14)에 들어가지 않기 때문이다
function buildSeed(items, placeOf) {
  const places = [];
  const placeIds = new Set();
  const reviews = [];
  const visits = [];

  for (const item of items) {
    const place = placeOf(item);
    if (!placeIds.has(place.id)) {
      placeIds.add(place.id);
      places.push({ id: place.id, name: place.name, lat: place.lat, lng: place.lng, category: place.category });
    }

    const anonId = seedAnonId(item.writer);
    if (item.text !== null) {
      reviews.push({
        id: 'seed-review-' + (reviews.length + 1),
        placeId: place.id,
        text: item.text,
        price: item.price,
        tags: item.tags,
        menu: item.menu,
        anonId: anonId,
        verified: true,
        createdAt: item.createdAt,
      });
    }
    if (item.again !== null) {
      visits.push({
        id: 'seed-visit-' + (visits.length + 1),
        placeId: place.id,
        again: item.again,
        anonId: anonId,
        roomCode: null,
        verified: true,
        createdAt: item.createdAt,
      });
    }
  }

  return { places, reviews, visits };
}

module.exports = {
  MAX_WRITER_LENGTH,
  seedDate,
  seedAnonId,
  validateItem,
  findDuplicates,
  choosePlace,
  buildSeed,
};
