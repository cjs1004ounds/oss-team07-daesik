// 첫 화면의 지도.
// 서버에서 카카오 JavaScript 키를 받아 카카오맵을 띄운다.
// 기록이 있는 가게를 마커로 찍고, 마커나 옆 칸의 목록을 누르면 그 가게의 한 줄 추천을 옆 칸에 보여 준다 (이슈 #13).
// 지도를 못 띄워도 옆 칸의 목록과 상세는 그대로 쓸 수 있다.
// 옆 칸 위의 필터 칸에서 가격 상한, 음식 종류, 태그를 고르면 GET /api/places 를 다시 불러
// 목록과 마커를 바꾼다 (이슈 #133). 거르기(R1~R3)와 정렬(R5)은 서버가 한다.

// 지도 가운데. 카카오에서 찾은 광운대학교 위치를 임시로 쓴다.
// 가게 검색의 가운데(server/kakao.js의 SEARCH_CENTER)와 같은 값이다. 바꿀 때는 두 곳을 같이 바꾼다.
// 학교 기준점은 아직 팀에서 못 정했다 (README "아직 못 정한 것")
const SCHOOL = { lat: 37.61924, lng: 127.05827 };

// 숫자가 작을수록 확대된다. 4는 학교 주변 골목이 보이는 정도
const MAP_LEVEL = 4;

// 이 시간 안에 지도가 안 뜨면 실패로 본다
const LOAD_TIMEOUT_MS = 8000;

const mapEl = document.getElementById('map');
const messageEl = document.getElementById('map-message');

const panelEl = document.getElementById('side-panel');

// 만들어진 지도. 마커를 찍을 때 이 변수를 쓴다
let map = null;

// GET /api/places 로 받은 가게 목록. 지도와 옆 칸이 같이 쓴다
let places = [];

// 지금 지도에 얹은 마커. 필터를 바꿔 다시 찍을 때 먼저 지운다
let overlays = [];

// 필터 칸에서 고를 수 있는 태그. R6 태그 목록과 같다.
// public/js/review.js, shared/reviewValidator.js, README에도 같은 목록이 있다. 바꿀 때는 네 곳을 같이 바꾼다
const FILTER_TAGS = ['양 많음', '혼밥', '가성비', '빨리 나옴', '조용함', '단체 가능', '늦게까지 함', '매움', '청결함'];

// 지금 고른 필터. 서버에 보낼 값 그대로 둔다
const filter = { maxPrice: '', category: '', tags: [] };

// 음식 종류 칸에 넣을 종류. 필터 없이 받은 가게들의 종류를 모은다.
// 필터로 걸러진 목록에서만 모으면 다른 종류로 바꿀 수 없게 되기 때문이다
const knownCategories = [];

// 필터 칸. 한 번만 만들고, 옆 칸을 다시 그릴 때마다 같은 칸을 다시 붙여서 고른 값이 남게 한다
const filterForm = makeFilterForm();

startMap();
loadPlaces();

async function startMap() {
  showMapMessage('지도를 불러오는 중입니다.');

  try {
    const res = await fetch('/api/config');
    const config = await res.json();

    if (!config.kakaoJsKey) {
      showMapMessage('지도 키가 설정되지 않아 지도를 띄우지 못했습니다. 가게 검색은 그대로 쓸 수 있습니다.');
      return;
    }

    await loadKakaoSdk(config.kakaoJsKey);
    drawMap();
    drawMarkers();
  } catch (err) {
    showMapMessage('지도를 불러오지 못했습니다. 가게 검색은 그대로 쓸 수 있습니다.');
  }
}

function showMapMessage(text) {
  messageEl.textContent = text;
}

// 카카오맵 SDK 스크립트를 페이지에 넣고, 준비가 끝나면 다음으로 넘어간다.
// 키가 있어야 주소를 만들 수 있어서 HTML에 미리 적지 않고 여기서 넣는다
function loadKakaoSdk(key) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(key) + '&autoload=false';
    script.onload = () => kakao.maps.load(resolve);
    script.onerror = reject;
    document.head.append(script);

    // 등록하지 않은 주소에서 열면 카카오가 응답을 안 줘서 계속 기다리게 된다
    setTimeout(() => reject(new Error('지도를 불러오는 데 너무 오래 걸립니다.')), LOAD_TIMEOUT_MS);
  });
}

function drawMap() {
  // 안내 글자를 지우고 그 자리에 지도를 그린다
  messageEl.remove();

  map = new kakao.maps.Map(mapEl, {
    center: new kakao.maps.LatLng(SCHOOL.lat, SCHOOL.lng),
    level: MAP_LEVEL,
  });

  // 창 크기가 바뀌거나 휴대폰을 돌리면 지도를 새 크기에 맞게 다시 그린다.
  // relayout만 하면 왼쪽 위가 고정된 채로 크기만 바뀌어서 보고 있던 곳이 밀린다.
  // 그래서 바꾸기 전의 가운데를 기억해 뒀다가 다시 맞춘다
  window.addEventListener('resize', () => {
    const center = map.getCenter();
    map.relayout();
    map.setCenter(center);
  });
}

// 기록이 있는 가게 목록을 받아 옆 칸에 보여 준다. 필터를 고른 상태면 그 조건을 같이 보낸다.
// 지도가 먼저 떠 있으면 마커도 이때 찍는다. 지도가 나중에 뜨면 drawMap 다음에 찍는다
async function loadPlaces() {
  let body;
  try {
    const res = await fetch('/api/places' + filterQuery());
    body = await res.json();
    if (!res.ok) {
      // 가격 상한이 숫자가 아니면 서버가 400과 이유를 돌려준다
      throw new Error(body.error || '가게 목록 요청 실패');
    }
  } catch (err) {
    showPanelMessage('가게 목록을 불러오지 못했습니다. 잠시 뒤에 새로고침해 주세요.');
    return;
  }

  places = body.places;
  if (!hasFilter()) {
    rememberCategories(places);
  }
  updateCategoryOptions();

  showPlaceList();
  drawMarkers();
}

// 지금 고른 필터를 주소 쿼리로. 고른 것이 없으면 빈 문자열
function filterQuery() {
  const params = new URLSearchParams();
  if (filter.maxPrice !== '') {
    params.set('maxPrice', filter.maxPrice);
  }
  if (filter.category !== '') {
    params.set('category', filter.category);
  }
  if (filter.tags.length > 0) {
    params.set('tags', filter.tags.join(','));
  }
  const query = params.toString();
  return query === '' ? '' : '?' + query;
}

function hasFilter() {
  return filter.maxPrice !== '' || filter.category !== '' || filter.tags.length > 0;
}

function rememberCategories(list) {
  for (const place of list) {
    const category = shortCategory(place.category);
    if (category !== '' && !knownCategories.includes(category)) {
      knownCategories.push(category);
    }
  }
  knownCategories.sort((a, b) => a.localeCompare(b, 'ko'));
}

// 필터 칸: 1인 가격 상한, 음식 종류, 태그, 필터 지우기
function makeFilterForm() {
  const form = document.createElement('form');
  form.className = 'filter-form';
  form.setAttribute('aria-label', '가게 거르기');

  // 1인 가격 상한. 숫자만 받고, 비우면 거르지 않는다
  const priceLabel = document.createElement('label');
  priceLabel.className = 'filter-field';
  priceLabel.textContent = '1인 가격 상한(원)';
  const priceInput = document.createElement('input');
  priceInput.type = 'text';
  priceInput.inputMode = 'numeric';
  priceInput.name = 'maxPrice';
  priceInput.placeholder = '예: 9000';
  priceInput.autocomplete = 'off';
  // 쉼표나 글자를 쳐도 숫자만 남긴다. 서버는 숫자만 받는다 (R3)
  priceInput.addEventListener('input', () => {
    priceInput.value = priceInput.value.replace(/[^0-9]/g, '');
  });
  // 칸을 벗어나거나 Enter를 치면 적용한다
  priceInput.addEventListener('change', () => applyFilter());
  priceLabel.append(priceInput);

  // 음식 종류. 기록된 가게의 종류에서 고른다
  const categoryLabel = document.createElement('label');
  categoryLabel.className = 'filter-field';
  categoryLabel.textContent = '음식 종류';
  const categorySelect = document.createElement('select');
  categorySelect.name = 'category';
  categorySelect.addEventListener('change', () => applyFilter());
  categoryLabel.append(categorySelect);

  // 태그. 여러 개 고르면 모두 나온 가게만 남는다 (R3)
  const tagGroup = document.createElement('div');
  tagGroup.className = 'filter-tags';
  tagGroup.setAttribute('role', 'group');
  tagGroup.setAttribute('aria-label', '태그 (고른 태그가 모두 있는 가게만)');
  for (const tag of FILTER_TAGS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-button';
    button.textContent = tag;
    button.dataset.tag = tag;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const pressed = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', pressed ? 'false' : 'true');
      applyFilter();
    });
    tagGroup.append(button);
  }

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'link-button filter-clear';
  clearButton.textContent = '필터 지우기';
  clearButton.addEventListener('click', clearFilter);

  // Enter를 쳐도 페이지가 다시 열리지 않게 막고 적용만 한다
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    applyFilter();
  });

  form.append(priceLabel, categoryLabel, tagGroup, clearButton);
  return form;
}

// 음식 종류 칸의 목록을 지금 아는 종류로 다시 채운다. 고른 값은 그대로 둔다
function updateCategoryOptions() {
  const select = filterForm.elements.category;
  const all = document.createElement('option');
  all.value = '';
  all.textContent = '전체';
  const options = [all];
  for (const category of knownCategories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    options.push(option);
  }
  select.replaceChildren(...options);
  select.value = filter.category;
}

// 필터 칸의 값을 읽어 다시 불러온다
function applyFilter() {
  filter.maxPrice = filterForm.elements.maxPrice.value.trim();
  filter.category = filterForm.elements.category.value;
  filter.tags = [...filterForm.querySelectorAll('.tag-button[aria-pressed="true"]')].map((button) => button.dataset.tag);
  loadPlaces();
}

function clearFilter() {
  filterForm.elements.maxPrice.value = '';
  filterForm.elements.category.value = '';
  for (const button of filterForm.querySelectorAll('.tag-button')) {
    button.setAttribute('aria-pressed', 'false');
  }
  applyFilter();
}

// 가게마다 기록 수가 적힌 마커를 찍는다.
// 카카오 기본 마커에는 글자를 넣을 수 없어서, 버튼을 만들어 지도 위에 얹는다(CustomOverlay)
function drawMarkers() {
  if (!map) {
    return;
  }

  // 필터를 바꾸면 전에 찍은 마커를 지우고 새로 찍는다
  for (const overlay of overlays) {
    overlay.setMap(null);
  }
  overlays = [];

  for (const place of places) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-marker';
    button.textContent = String(place.reviewCount);
    button.title = place.name;
    button.setAttribute('aria-label', `${place.name}, 한 줄 추천 ${place.reviewCount}개`);
    button.addEventListener('click', () => showPlaceDetail(place.id));

    const overlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(place.lat, place.lng),
      content: button,
      yAnchor: 1,
    });
    overlay.setMap(map);
    overlays.push(overlay);
  }
}

// 옆 칸: 기록이 있는 가게 목록
function showPlaceList() {
  panelEl.replaceChildren();

  const title = document.createElement('h2');
  title.textContent = '기록이 있는 가게';

  // 기록이 하나도 없을 때는 필터 칸을 보여 줄 필요가 없다
  if (places.length === 0 && !hasFilter()) {
    const empty = document.createElement('p');
    empty.className = 'sub';
    empty.textContent = '아직 기록이 없습니다. 오른쪽 위의 기록 남기기에서 첫 한 줄 추천을 남겨 주세요.';
    panelEl.append(title, empty);
    return;
  }

  // 순서 안내. 정렬은 서버가 한다 (R5)
  const order = document.createElement('p');
  order.className = 'sub';
  order.textContent = `걸어서 15분 안 ${places.length}곳 · 또 갈래요 비율이 높은 순`;

  panelEl.append(title, filterForm, order);

  if (places.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sub';
    empty.textContent = '조건에 맞는 가게가 없습니다.';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'link-button';
    clear.textContent = '필터 지우기';
    clear.addEventListener('click', clearFilter);
    panelEl.append(empty, clear);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'place-list';

  for (const place of places) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-list-item';
    button.addEventListener('click', () => showPlaceDetail(place.id));

    const name = document.createElement('strong');
    name.textContent = place.name;

    const info = document.createElement('span');
    info.className = 'sub';
    info.textContent = placeSummaryText(place);

    button.append(name, info);

    // 지금 상황 제보가 있으면 한 줄 더 (R16)
    if (place.live) {
      const live = document.createElement('span');
      live.className = 'live-status';
      live.textContent = liveText(place.live);
      button.append(live);
    }
    item.append(button);
    list.append(item);
  }

  panelEl.append(list);
}

// 목록의 가게 한 줄 설명: 종류 · 걸어서 몇 분 · 또 갈래요 비율 · 추천 수
function placeSummaryText(place) {
  const parts = [shortCategory(place.category)];
  if (Number.isFinite(place.walkMinutes)) {
    parts.push(`걸어서 ${place.walkMinutes}분`);
  }
  parts.push(place.againRatio === null || place.againRatio === undefined ? '기록 부족' : `또 갈래요 ${place.againRatio}%`);
  parts.push(`추천 ${place.reviewCount}개`);
  return parts.filter((part) => part !== '').join(' · ');
}

// 옆 칸: 가게 하나와 그 가게의 한 줄 추천
async function showPlaceDetail(placeId) {
  showPanelMessage('불러오는 중입니다.');

  let body;
  try {
    const res = await fetch('/api/places/' + encodeURIComponent(placeId));
    if (!res.ok) {
      throw new Error('가게 상세 요청 실패');
    }
    body = await res.json();
  } catch (err) {
    showPanelMessage('가게 정보를 불러오지 못했습니다.');
    panelEl.append(makeBackButton());
    return;
  }

  const { place, reviews } = body;
  panelEl.replaceChildren();
  panelEl.append(makeBackButton());

  const title = document.createElement('h2');
  title.textContent = place.name;

  const category = document.createElement('p');
  category.className = 'sub';
  category.textContent = `${shortCategory(place.category)} · 한 줄 추천 ${reviews.length}개`;

  panelEl.append(title, category);
  if (body.stats) {
    panelEl.append(makeStatsLine(body.stats));
  }

  // 지금 상황 (R16). 30분 안 제보와 제보 버튼
  panelEl.append(makeLiveBox(place.id, body.live));

  // 한 줄 추천들을 LLM이 정리한 요약. 추천이 2개보다 적거나 만들지 못했으면 없다
  if (body.summary) {
    const summary = document.createElement('p');
    summary.className = 'place-summary';
    summary.textContent = body.summary;
    summary.title = '한 줄 추천들을 모아 LLM이 정리한 요약입니다.';
    panelEl.append(summary);
  }

  if (map) {
    map.panTo(new kakao.maps.LatLng(place.lat, place.lng));
  }

  const list = document.createElement('ul');
  list.className = 'review-list';

  for (const review of reviews) {
    const item = document.createElement('li');

    const text = document.createElement('p');
    text.className = 'review-text';
    text.textContent = review.text;
    item.append(text);

    // 가격과 태그는 적은 경우에만 보여 준다
    const extras = [];
    if (review.price !== null && review.price !== undefined) {
      // 이상한 가격으로 보류된 것(R17)은 평균에 안 들어간다고 알려 준다
      const held = review.priceHeld ? ' (가격 확인 중, 평균에서 뺌)' : '';
      extras.push(`1인 ${review.price.toLocaleString('ko-KR')}원${held}`);
    }
    if (Array.isArray(review.tags)) {
      extras.push(...review.tags);
    }
    extras.push(formatDate(review.createdAt));

    const meta = document.createElement('p');
    meta.className = 'sub';
    meta.textContent = extras.join(' · ');
    item.append(meta);

    // 신고 (R15). 누르면 확인을 받고 POST /api/reports
    const reportButton = document.createElement('button');
    reportButton.type = 'button';
    reportButton.className = 'report-button';
    reportButton.textContent = '신고';
    reportButton.addEventListener('click', () => reportReview(review.id, item, reportButton));
    item.append(reportButton);

    list.append(item);
  }

  panelEl.append(list);
}

// 지금 상황 제보를 한 줄 글로. 예: "12분 전 웨이팅 있다는 제보 (30분 안에 웨이팅 2, 자리 1)"
function liveText(live) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(live.latestAt).getTime()) / 60000));
  const latest = live.latestKind === 'waiting' ? '웨이팅 있다는' : '자리 있다는';
  return `${minutes}분 전 ${latest} 제보 (30분 안에 웨이팅 ${live.waiting}, 자리 ${live.seats})`;
}

// 가게 상세의 지금 상황 칸. 제보 내용과 "웨이팅 있어요", "자리 있어요" 버튼
function makeLiveBox(placeId, live) {
  const box = document.createElement('div');
  box.className = 'live-box';

  const text = document.createElement('p');
  text.className = 'live-status';
  text.textContent = live ? liveText(live) : '30분 안에 들어온 웨이팅, 자리 제보가 없습니다.';

  const buttons = document.createElement('div');
  buttons.className = 'live-buttons';
  for (const [kind, label] of [['waiting', '웨이팅 있어요'], ['seats', '자리 있어요']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', async () => {
      for (const other of buttons.querySelectorAll('button')) {
        other.disabled = true;
      }
      try {
        const res = await fetch('/api/places/' + encodeURIComponent(placeId) + '/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: kind, anonId: getOrCreateAnonId() }),
        });
        const data = await res.json();
        text.textContent = res.ok ? liveText(data.live) + ' 제보 고마워요.' : (data.error || '제보하지 못했습니다.');
      } catch (err) {
        text.textContent = '서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.';
        for (const other of buttons.querySelectorAll('button')) {
          other.disabled = false;
        }
      }
    });
    buttons.append(button);
  }

  box.append(text, buttons);
  return box;
}

// 가게 상세의 비율, 가격, 마지막 기록 한 줄 (R14). 최근 기록일수록 크게 반영한 값이다
function makeStatsLine(stats) {
  const parts = [];
  if (stats.againRatio === null) {
    parts.push(`또 갈래요 비율은 기록 부족 (교내 인증 응답 ${stats.responseCount}개)`);
  } else {
    parts.push(`또 갈래요 ${stats.againRatio}% (교내 인증 응답 ${stats.responseCount}개)`);
  }
  if (stats.averagePrice !== null) {
    parts.push(`1인 약 ${stats.averagePrice.toLocaleString('ko-KR')}원`);
  }
  if (stats.lastRecordAt) {
    parts.push(`마지막 기록 ${formatDate(stats.lastRecordAt)}`);
  }

  const line = document.createElement('p');
  line.className = 'place-stats';
  line.textContent = parts.join(', ');
  line.title = '최근 기록일수록 크게 반영하고, 1년이 지난 기록은 넣지 않습니다.';
  return line;
}

// 한 줄 추천을 신고한다. 숨겨지면 목록에서 바로 빼고, 아니면 신고했다고만 보여 준다
async function reportReview(reviewId, item, button) {
  if (!confirm('이 한 줄 추천을 신고할까요? 욕설, 개인정보, 광고, 허위 사실 같은 글을 신고해 주세요.')) {
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: reviewId, anonId: getOrCreateAnonId() }),
    });
    const body = await res.json();

    if (res.ok && body.hidden) {
      item.replaceChildren();
      const notice = document.createElement('p');
      notice.className = 'sub';
      notice.textContent = '신고가 반영돼 이 한 줄 추천을 숨겼습니다.';
      item.append(notice);
      return;
    }
    button.textContent = res.ok ? '신고함' : (body.error || '신고하지 못했습니다.');
  } catch (err) {
    button.textContent = '신고하지 못했습니다. 다시 눌러 주세요.';
    button.disabled = false;
  }
}

// 익명 ID. 한 줄 추천 작성 화면(js/review.js)과 같은 이름으로 localStorage에 둔다 (docs/api.md "익명 ID")
function getOrCreateAnonId() {
  let anonId = localStorage.getItem('anonId');
  if (!anonId) {
    anonId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'anon-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('anonId', anonId);
  }
  return anonId;
}

function makeBackButton() {
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'link-button';
  back.textContent = '목록으로';
  back.addEventListener('click', showPlaceList);
  return back;
}

function showPanelMessage(text) {
  panelEl.replaceChildren();
  const message = document.createElement('p');
  message.className = 'sub';
  message.textContent = text;
  panelEl.append(message);
}

// 카카오 분류 "음식점 > 한식 > 국밥" 에서 둘째 단계("한식")만 쓴다. 없으면 받은 그대로 둔다 (#21)
function shortCategory(category) {
  const parts = String(category || '').split('>').map((part) => part.trim());
  return parts[1] || parts[0] || '';
}

// "2026-11-24T08:00:00.000Z" -> "11월 24일" (한국 시간)
function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });
}