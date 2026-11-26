// 교내 인증 칸 (가게 검색 화면).
// 화면을 열면 GET /api/verify/:anonId 로 인증 상태를 보여 주고,
// 버튼을 누르면 POST /api/verify 를 부른다. 학교 와이파이가 아니면 위치를 물어보고 한 번 더 보낸다.

const verifyBox = document.getElementById('verify-box');
const verifyStatus = document.getElementById('verify-status');
const verifyButton = document.getElementById('verify-button');

// 브라우저 위치를 물을 때의 설정. 오차가 150m를 넘으면 서버가 받지 않아서 정확한 위치를 요청한다
const LOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

// "2026-12-23T03:00:00.000Z" -> "12월 23일"
function formatDate(isoText) {
  const date = new Date(isoText);
  return (date.getMonth() + 1) + '월 ' + date.getDate() + '일';
}

function showVerified(expiresAt) {
  verifyBox.classList.add('is-verified');
  verifyStatus.textContent = '교내 인증됨 (' + formatDate(expiresAt) + '까지)';
  verifyButton.hidden = true;
}

function showNotVerified(text) {
  verifyBox.classList.remove('is-verified');
  verifyStatus.textContent = text || '교내 인증을 하면 남긴 기록이 순위에 들어갑니다. 학교 안에서 눌러 주세요.';
  verifyButton.hidden = false;
  verifyButton.disabled = false;
}

// 화면을 열었을 때 지금 상태를 가져온다. 익명 ID가 아직 없으면 인증한 적도 없는 것이다
async function loadVerifyStatus() {
  const anonId = localStorage.getItem('anonId');
  if (!anonId) {
    showNotVerified();
    return;
  }

  try {
    const res = await fetch('/api/verify/' + encodeURIComponent(anonId));
    const data = await res.json();
    if (res.ok && data.verified) {
      showVerified(data.expiresAt);
    } else {
      showNotVerified();
    }
  } catch (err) {
    showNotVerified('인증 상태를 불러오지 못했습니다. 그래도 인증 버튼은 누를 수 있습니다.');
  }
}

// 서버에 인증을 요청한다. location이 없으면 와이파이로만 판정해 달라는 뜻이다
async function requestVerify(location) {
  const body = { anonId: getOrCreateAnonId() };
  if (location) {
    body.lat = location.lat;
    body.lng = location.lng;
    body.accuracy = location.accuracy;
  }

  const res = await fetch('/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, data: data };
}

// 브라우저에 위치를 물어본다. 실패하면 { userMessage } 를 던진다. 화면에 그대로 보여 줄 문구다
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ userMessage: '이 브라우저는 위치를 알려 주지 않습니다. 학교 와이파이에 연결한 뒤 다시 눌러 주세요.' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject({ userMessage: '위치 권한을 허락하지 않아 인증하지 못했습니다. 학교 와이파이에 연결한 뒤 다시 눌러 주세요.' });
        } else {
          reject({ userMessage: '위치를 알아내지 못했습니다. 잠시 뒤에 다시 눌러 주세요.' });
        }
      },
      LOCATION_OPTIONS
    );
  });
}

verifyButton.addEventListener('click', async () => {
  verifyButton.disabled = true;
  verifyStatus.textContent = '학교 안인지 확인하는 중입니다.';

  try {
    // 먼저 위치 없이 보낸다. 학교 와이파이면 위치를 묻지 않고 끝난다
    let result = await requestVerify(null);

    if (!result.ok && result.data.needLocation) {
      verifyStatus.textContent = '위치를 확인하는 중입니다.';
      const location = await getLocation();
      result = await requestVerify(location);
    }

    if (result.ok) {
      showVerified(result.data.expiresAt);
    } else {
      showNotVerified(result.data.error || '인증하지 못했습니다.');
    }
  } catch (err) {
    // 위치를 못 받았으면 그 이유를, 서버에 연결하지 못했으면 연결 안내를 보여 준다
    showNotVerified(err.userMessage || '서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.');
  }
});

// 내 기록 수와 칭호를 보여 준다 (GET /api/me/:anonId, R18).
// 교내 인증 상태에서 남긴 기록만 센다. 기록이 없거나 불러오지 못하면 숨긴 채로 둔다
async function loadMyRecords() {
  const myRecords = document.getElementById('my-records');
  const anonId = localStorage.getItem('anonId');
  if (!anonId) {
    return;
  }

  try {
    const res = await fetch('/api/me/' + encodeURIComponent(anonId));
    if (!res.ok) {
      return;
    }
    const me = await res.json();
    if (!me.title) {
      return;
    }

    let text = '내 칭호: ' + me.title + ' (기록 ' + me.recordCount + '개, 가게 ' + me.placeCount + '곳)';
    if (me.nextTitle) {
      text += '. ' + me.remaining + '개 더 남기면 ' + me.nextTitle;
    }
    myRecords.textContent = text;
    myRecords.hidden = false;
  } catch (err) {
    // 못 불러와도 인증과 검색은 그대로 쓸 수 있다
  }
}

loadVerifyStatus();
loadMyRecords();
