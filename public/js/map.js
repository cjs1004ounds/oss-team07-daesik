// 첫 화면의 지도.
// 서버에서 카카오 JavaScript 키를 받아 카카오맵을 띄운다.
// 지금은 학교를 가운데에 둔 지도만 보여 준다. 가게 마커와 상세는 여기에 이어서 붙인다 (이슈 #13).

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

// 만들어진 지도. 마커를 찍을 때 이 변수를 쓴다
let map = null;

startMap();

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
