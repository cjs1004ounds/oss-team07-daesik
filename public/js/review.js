// 한 줄 추천 작성 화면.
// 검색 화면에서 고른 가게에 한 줄 추천을 입력받아 POST /api/reviews 로 저장한다.

// R6 규칙에서 허용하는 고정 태그 8개 및 최대 선택 개수
const ALLOWED_TAGS = [
  '양 많음',
  '혼밥',
  '가성비',
  '빨리 나옴',
  '조용함',
  '단체 가능',
  '늦게까지 함',
  '매움',
];
const MAX_TAGS = 3;
const MAP_PAGE = '/';

// 화면의 주요 HTML 요소 참조
const placeNameEl = document.getElementById('place-name');
const placeCategoryEl = document.getElementById('place-category');
const form = document.getElementById('review-form');
const textInput = document.getElementById('review-text');
const textCountEl = document.getElementById('text-count');
const priceInput = document.getElementById('review-price');
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

// 허용된 태그 8개를 토글 버튼으로 만들어 화면에 붙인다. 최대 3개까지 고를 수 있다
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
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 1000 || num > 100000) {
    return { ok: false, error: '가격은 1,000원 이상 100,000원 이하의 정수로 입력해 주세요.' };
  }
  return { ok: true, value: num };
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