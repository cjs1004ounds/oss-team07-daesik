// 고를 수 있는 태그 목록. 화면(public/js/review.js)과 README에도 같은 목록이 있다.
// 바꿀 때는 세 곳을 같이 바꾼다
const ALLOWED_TAGS = [
  '양 많음',
  '혼밥',
  '가성비',
  '빨리 나옴',
  '조용함',
  '단체 가능',
  '늦게까지 함',
  '매움',
  '청결함'
];

/**
 * R6: 한 줄 추천 입력값 검사
 * - 문장 길이: 앞뒤 공백 제외 5~100자
 * - 가격: 비워 두거나(null/undefined/'') 1,000~100,000 사이 정수
 * - 태그: 허용 목록에 있는 것만 중복 없이 최대 3개
 *
 * @param {object} input - { text, price, tags }
 * @returns {{ ok: true, value: { text: string, price: number | null, tags: string[] } } | { ok: false, error: string }}
 */
function validateReviewInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '요청 데이터가 올바르지 않습니다.' };
  }

  const { text, price, tags } = input;

  // 1. 문장 길이 검사 (5~100자)
  if (typeof text !== 'string') {
    return { ok: false, error: '한 줄 추천 문장을 입력해 주세요.' };
  }
  const trimmedText = text.trim();
  if (trimmedText.length < 5 || trimmedText.length > 100) {
    return { ok: false, error: '한 줄 추천은 5자 이상 100자 이하로 입력해 주세요.' };
  }

  // 2. 가격 검사 (비워 두거나 1,000~100,000 사이 정수)
  let normalizedPrice = null;
  if (price !== undefined && price !== null && price !== '') {
    if (typeof price !== 'number' || !Number.isInteger(price)) {
      return { ok: false, error: '가격은 정수로 입력해 주세요.' };
    }
    if (price < 1000 || price > 100000) {
      return { ok: false, error: '가격은 1,000원 이상 100,000원 이하로 입력해 주세요.' };
    }
    normalizedPrice = price;
  }

  // 3. 태그 검사 (목록에 있는 것만, 중복 없이 최대 3개)
  let normalizedTags = [];
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) {
      return { ok: false, error: '태그는 배열 형식이어야 합니다.' };
    }
    if (tags.length > 3) {
      return { ok: false, error: '태그는 최대 3개까지 선택할 수 있습니다.' };
    }
    if (new Set(tags).size !== tags.length) {
      return { ok: false, error: '중복된 태그는 선택할 수 없습니다.' };
    }
    for (const tag of tags) {
      if (typeof tag !== 'string' || !ALLOWED_TAGS.includes(tag)) {
        return { ok: false, error: '허용되지 않은 태그입니다.' };
      }
    }
    normalizedTags = [...tags];
  }

  return {
    ok: true,
    value: {
      text: trimmedText,
      price: normalizedPrice,
      tags: normalizedTags
    }
  };
}

// 먹은 메뉴 최대 길이
const MAX_MENU_LENGTH = 20;

/**
 * R6: 먹은 메뉴 검사 (선택 칸)
 * - 비워 두면(null/undefined/'' 또는 공백만) null
 * - 적었으면 앞뒤 공백을 떼고 20자 이하
 * validateReviewInput과 따로 둔 이유: 먹은 메뉴는 나중에 더한 칸이라, 앞의 검사가 돌려주는 값의 모양을 바꾸지 않으려는 것이다
 *
 * @param {unknown} menu
 * @returns {{ ok: true, value: string | null } | { ok: false, error: string }}
 */
function validateMenu(menu) {
  if (menu === undefined || menu === null) {
    return { ok: true, value: null };
  }
  if (typeof menu !== 'string') {
    return { ok: false, error: '먹은 메뉴는 글자로 입력해 주세요.' };
  }
  const trimmed = menu.trim().replace(/\s+/g, ' ');
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  if (trimmed.length > MAX_MENU_LENGTH) {
    return { ok: false, error: `먹은 메뉴는 ${MAX_MENU_LENGTH}자 이하로 입력해 주세요.` };
  }
  return { ok: true, value: trimmed };
}

module.exports = {
  ALLOWED_TAGS,
  MAX_MENU_LENGTH,
  validateReviewInput,
  validateMenu
};