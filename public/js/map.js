// 첫 화면의 지도.
// 서버에서 카카오 JavaScript 키를 받아 카카오맵을 띄운다.
// 기록이 있는 가게를 마커로 찍고, 마커나 옆 칸의 목록을 누르면 그 가게의 한 줄 추천을 옆 칸에 보여 준다 (이슈 #13).
// 지도를 못 띄워도 옆 칸의 목록과 상세는 그대로 쓸 수 있다.

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

// 기록이 있는 가게 목록을 받아 옆 칸에 보여 준다.
// 지도가 먼저 떠 있으면 마커도 이때 찍는다. 지도가 나중에 뜨면 drawMap 다음에 찍는다
async function loadPlaces() {
  try {
    const res = await fetch('/api/places');
    if (!res.ok) {
      throw new Error('가게 목록 요청 실패');
    }
    const body = await res.json();
    places = body.places;
  } catch (err) {
    showPanelMessage('가게 목록을 불러오지 못했습니다. 잠시 뒤에 새로고침해 주세요.');
    return;
  }

  showPlaceList();
  drawMarkers();
}

// 가게마다 기록 수가 적힌 마커를 찍는다.
// 카카오 기본 마커에는 글자를 넣을 수 없어서, 버튼을 만들어 지도 위에 얹는다(CustomOverlay)
function drawMarkers() {
  if (!map || places.length === 0) {
    return;
  }

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
  }
}

// 옆 칸: 기록이 있는 가게 목록
function showPlaceList() {
  panelEl.replaceChildren();

  const title = document.createElement('h2');
  title.textContent = '기록이 있는 가게';
  panelEl.append(title);

  if (places.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sub';
    empty.textContent = '아직 기록이 없습니다. 오른쪽 위의 기록 남기기에서 첫 한 줄 추천을 남겨 주세요.';
    panelEl.append(empty);
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
    info.textContent = `${shortCategory(place.category)} · 한 줄 추천 ${place.reviewCount}개`;

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
      extras.push(`1인 ${review.price.toLocaleString('ko-KR')}원`);
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
