// 한 줄 추천 작성 화면.
// 검색 화면에서 고른 가게에 한 줄 추천을 입력받아 POST /api/reviews 로 저장한다.

// R6 규칙에서 허용하는 태그 목록과 최대 선택 개수.
// 서버 검사(shared/reviewValidator.js)와 README에도 같은 목록이 있다. 바꿀 때는 세 곳을 같이 바꾼다
const ALLOWED_TAGS = [
  '양 많음',
  '혼밥',
  '가성비',
  '빨리 나옴',
  '조용함',
  '단체 가능',
  '늦게까지 함',
  '매움',
  '청결함',
];
const MAX_TAGS = 3;
const MAP_PAGE = '/';

// 가격 범위(R6)와 올리기, 내리기 버튼을 한 번 누를 때 바뀌는 값
const PRICE_MIN = 1000;
const PRICE_MAX = 100000;
const PRICE_STEP = 100;

// 화면의 주요 HTML 요소 참조
const placeNameEl = document.getElementById('place-name');
const placeCategoryEl = document.getElementById('place-category');
const form = document.getElementById('review-form');
const textInput = document.getElementById('review-text');
const textCountEl = document.getElementById('text-count');
const priceInput = document.getElementById('review-price');
const priceDownButton = document.getElementById('price-down');
const priceUpButton = document.getElementById('price-up');
const tagListEl = document.getElementById('tag-list');
const messageEl = document.getElementById('form-message');
const submitButton = document.getElementById('submit-button');

// 현재 선택된 태그들을 중복 없이 관리하는 집합
const selectedTags = new Set();

// 페이지가 열릴 때 sessionStorage에서 선택된 가게 정보를 불러온다
const selectedPlace = loadSelectedPlace();

if (selectedPlace) {
  // HTML 태그가 해석되지 않도록 반드시 textContent로 삽입한다 (XSS 방지)
  placeNameEl.textContent = selectedPlace.name;
  placeCategoryEl.textContent = shortCategory(selectedPlace.category);
  renderTagButtons();
}

// 추천 문장을 입력할 때마다 앞뒤 공백을 제외한 현재 글자 수를 표시한다
textInput.addEventListener('input', () => {
  const length = textInput.value.trim().length;
  textCountEl.textContent = `${length} / 100자`;
});

// 가격을 입력할 때마다 숫자만 남기고 천 단위 쉼표를 다시 붙인다 (7000 -> 7,000)
priceInput.addEventListener('input', () => {
  // 쉼표가 생기거나 없어지면 커서가 밀린다.
  // 커서 앞에 숫자가 몇 개 있었는지 기억해 뒀다가 같은 자리로 돌려놓는다
  const digitsBeforeCaret = digitsOnly(priceInput.value.slice(0, priceInput.selectionStart)).length;

  // 100,000이 가장 큰 값이라 숫자는 6개까지만 받는다
  const digits = digitsOnly(priceInput.value).slice(0, 6);
  priceInput.value = formatPrice(digits);
  moveCaretAfterDigits(priceInput, digitsBeforeCaret);
});

// 가격 칸에서 위아래 방향키를 누르면 100원씩 바뀐다
priceInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    stepPrice(PRICE_STEP);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    stepPrice(-PRICE_STEP);
  }
});

priceUpButton.addEventListener('click', () => stepPrice(PRICE_STEP));
priceDownButton.addEventListener('click', () => stepPrice(-PRICE_STEP));

// 폼 제출 시 페이지 새로고침을 막고 비동기 저장 함수를 실행한다
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitReview();
});

// 검색 화면이 sessionStorage에 넣어 둔 가게를 꺼낸다.
// 주소를 직접 입력해 들어오는 등 가게 정보가 없으면 검색 화면으로 돌려보낸다
function loadSelectedPlace() {
  const saved = sessionStorage.getItem('selectedPlace');
  if (!saved) {
    // replace를 쓰면 현재 페이지가 브라우저 히스토리에 남지 않아 뒤로가기 루프를 막을 수 있다
    location.replace('/search.html');
    return null;
  }

  try {
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.name !== 'string') {
      location.replace('/search.html');
      return null;
    }
    return parsed;
  } catch (err) {
    // 저장된 JSON 문자열이 손상된 경우에도 안전하게 검색 화면으로 이동한다
    location.replace('/search.html');
    return null;
  }
}

// 화면 표시용으로 카테고리 앞부분의 공통 접두어("음식점 > ")만 제거한다.
// 서버로 보낼 때는 원본 selectedPlace.category 값을 그대로 사용한다
function shortCategory(category) {
  if (typeof category !== 'string') {
    return '';
  }
  return category.replace(/^음식점( > )?/, '');
}

// 허용된 태그를 토글 버튼으로 만들어 화면에 붙인다. 최대 3개까지 고를 수 있다
function renderTagButtons() {
  for (const tag of ALLOWED_TAGS) {
    const button = document.createElement('button');
    button.type = 'button'; // form 안에서 기본 submit 버튼으로 동작하지 않게 지정
    button.className = 'tag-button';
    button.setAttribute('aria-pressed', 'false'); // CSS 선택 상태 스타일 및 스크린리더 접근성용
    button.textContent = tag;

    button.addEventListener('click', () => {
      // 이미 선택된 태그를 다시 누르면 선택 해제
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
        button.setAttribute('aria-pressed', 'false');
        showMessage('');
        return;
      }

      // 최대 선택 개수(3개)를 넘으면 안내 문구를 띄우고 추가하지 않는다
      if (selectedTags.size >= MAX_TAGS) {
        showMessage(`태그는 최대 ${MAX_TAGS}개까지 고를 수 있습니다.`);
        return;
      }

      selectedTags.add(tag);
      button.setAttribute('aria-pressed', 'true');
      showMessage('');
    });

    tagListEl.append(button);
  }
}

// 브라우저별 익명 ID를 localStorage에서 가져오거나, 첫 방문이면 무작위로 생성해 저장한다
function getOrCreateAnonId() {
  let anonId = localStorage.getItem('anonId');
  if (!anonId) {
    // HTTPS 또는 localhost 환경에서는 표준 UUID를 쓰고, 지원되지 않는 환경은 대체 문자열을 만든다
    anonId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'anon-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('anonId', anonId);
  }
  return anonId;
}

// 가격 입력칸 문자열을 검사해 숫자 또는 null(미입력)로 변환한다
function parsePriceInput(raw) {
  // 화면에는 쉼표가 붙어 있으므로 떼고 본다
  const trimmed = raw.replace(/,/g, '').trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 1000 || num > 100000) {
    return { ok: false, error: '가격은 1,000원 이상 100,000원 이하의 정수로 입력해 주세요.' };
  }
  return { ok: true, value: num };
}

// 글자에서 숫자만 남긴다. "7,000원" -> "7000"
function digitsOnly(text) {
  return text.replace(/[^0-9]/g, '');
}

// 숫자 글자에 천 단위 쉼표를 붙인다. "7000" -> "7,000". 빈 값은 그대로 빈 값
function formatPrice(digits) {
  if (digits === '') {
    return '';
  }
  return Number(digits).toLocaleString('ko-KR');
}

// 입력 칸의 커서를 앞에서부터 숫자 count개를 지난 자리에 둔다
function moveCaretAfterDigits(input, count) {
  let position = 0;
  let seen = 0;
  while (position < input.value.length && seen < count) {
    if (/[0-9]/.test(input.value[position])) {
      seen += 1;
    }
    position += 1;
  }
  input.setSelectionRange(position, position);
}

// 가격을 amount만큼 바꾼다 (+100 또는 -100).
// 비어 있으면 가장 낮은 가격부터 시작하고, 7,550처럼 100원 단위가 아니면 가까운 100원 단위로 맞춘다
function stepPrice(amount) {
  const digits = digitsOnly(priceInput.value);

  let next;
  if (digits === '') {
    next = PRICE_MIN;
  } else if (amount > 0) {
    next = Math.floor(Number(digits) / PRICE_STEP) * PRICE_STEP + PRICE_STEP;
  } else {
    next = Math.ceil(Number(digits) / PRICE_STEP) * PRICE_STEP - PRICE_STEP;
  }

  // 범위를 벗어나지 않게 한다
  next = Math.min(PRICE_MAX, Math.max(PRICE_MIN, next));
  priceInput.value = formatPrice(String(next));
}

// 오류 또는 안내 문구를 화면에 표시한다
function showMessage(text) {
  messageEl.textContent = text;
}

// 입력값을 검증한 뒤 POST /api/reviews 로 한 줄 추천을 저장하고 지도 화면으로 이동한다
async function submitReview() {
  if (!selectedPlace) {
    return;
  }

  // 1. 한 줄 추천 문장 길이 검사 (앞뒤 공백 제외 5~100자)
  const trimmedText = textInput.value.trim();
  if (trimmedText.length < 5 || trimmedText.length > 100) {
    showMessage('한 줄 추천은 5자 이상 100자 이하로 입력해 주세요.');
    textInput.focus();
    return;
  }

  // 2. 가격 입력값 검사 (선택 항목이므로 비어 있으면 null)
  const priceResult = parsePriceInput(priceInput.value);
  if (!priceResult.ok) {
    showMessage(priceResult.error);
    priceInput.focus();
    return;
  }

  // 3. 중복 전송을 막기 위해 요청 중에는 저장 버튼을 비활성화한다
  showMessage('');
  submitButton.disabled = true;
  submitButton.textContent = '저장하는 중...';

  try {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: selectedPlace,
        text: trimmedText,
        price: priceResult.value,
        tags: Array.from(selectedTags),
        anonId: getOrCreateAnonId(),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      // 서버 R6 검증 실패 등 오류 응답 시 서버가 내려준 이유를 그대로 보여 준다
      showMessage(data.error || '저장하지 못했습니다.');
      return;
    }

    // 4. 저장이 완료되면 임시 선택 가게 데이터를 지우고 지도 화면으로 이동한다
    sessionStorage.removeItem('selectedPlace');
    location.href = MAP_PAGE;
  } catch (err) {
    // 네트워크 단절 등으로 서버에 닿지 못한 경우
    showMessage('서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.');
  } finally {
    // 오류가 나서 현재 화면에 머무를 경우 다시 시도할 수 있도록 버튼을 복구한다
    submitButton.disabled = false;
    submitButton.textContent = '저장하기';
  }
}