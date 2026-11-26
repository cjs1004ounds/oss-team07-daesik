// 가게 검색 화면.
// 검색어로 GET /api/places/search 를 부르고, 고른 가게를 작성 화면으로 넘긴다.

// 가게를 고르면 이동할 화면
const REVIEW_PAGE = '/review.html';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const button = document.getElementById('search-button');
const message = document.getElementById('search-message');
const results = document.getElementById('search-results');
const trendsBox = document.getElementById('trends');
const trendTitle = document.getElementById('trend-title');
const trendList = document.getElementById('trend-list');

form.addEventListener('submit', (event) => {
  // 폼을 제출하면 화면이 새로 고쳐지는 기본 동작을 막는다
  event.preventDefault();
  searchPlaces(input.value);
});

// 서버에 검색을 요청하고 결과에 따라 화면을 바꾼다
async function searchPlaces(query) {
  if (query.trim() === '') {
    showMessage('검색어를 입력해 주세요.');
    return;
  }

  results.replaceChildren();
  showMessage('찾는 중입니다.');
  button.disabled = true;

  try {
    const res = await fetch('/api/places/search?q=' + encodeURIComponent(query));
    const data = await res.json();

    if (!res.ok) {
      // 서버가 돌려준 오류 문구를 그대로 보여 준다
      showMessage(data.error || '검색하지 못했습니다.');
      return;
    }

    if (data.places.length === 0) {
      showMessage('찾은 가게가 없습니다. 다른 검색어로 해 보세요.');
      return;
    }

    showMessage('가게를 고르면 한 줄 추천을 쓰는 화면으로 넘어갑니다.');
    showResults(data.places);
  } catch (err) {
    // 서버에 연결하지 못한 경우
    showMessage('서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.');
  } finally {
    button.disabled = false;
  }
}

function showMessage(text) {
  message.textContent = text;
}

// 가게마다 버튼을 하나씩 만들어 목록에 넣는다.
// 가게 이름 같은 값은 textContent로 넣어서 HTML로 해석되지 않게 한다.
// 우리 기록으로 찾은 가게(fromRecords)에는 그렇다고 한 줄 더 보여 준다.
// 연관 검색어로 찾은 가게(via)에는 어떤 검색어로 찾았는지 보여 준다
function showResults(places) {
  for (const place of places) {
    const name = document.createElement('strong');
    name.className = 'place-name';
    name.textContent = place.name;

    const category = document.createElement('span');
    category.className = 'place-category';
    category.textContent = shortCategory(place.category);

    // 첫 줄: 이름과 분류
    const title = document.createElement('span');
    title.className = 'place-title';
    title.append(name, category);

    const placeButton = document.createElement('button');
    placeButton.type = 'button';
    placeButton.className = 'place-button';
    placeButton.append(title);

    // 기록으로 찾은 가게 표시
    if (place.fromRecords) {
      const record = document.createElement('span');
      record.className = 'place-record';
      record.textContent = '한 줄 추천에서 찾음';
      placeButton.append(record);
    }

    if (place.via) {
      const via = document.createElement('span');
      via.className = 'place-via';
      via.textContent = '연관 검색어: ' + place.via;
      placeButton.append(via);
    }

    // 주소. 기록으로만 찾은 가게는 주소를 저장하지 않아서 없다
    if (place.address) {
      const address = document.createElement('span');
      address.className = 'place-address';
      address.textContent = place.address;
      placeButton.append(address);
    }

    placeButton.addEventListener('click', () => selectPlace(place));

    const item = document.createElement('li');
    item.append(placeButton);
    results.append(item);
  }
}

// 화면에 보여 줄 때만 분류를 짧게 만든다.
// 카카오 분류는 "음식점 > 일식 > 돈까스,우동"처럼 오는데 맨 앞의 "음식점"은 모든 가게가 같아서 뺀다.
// 저장하거나 넘길 때는 원래 값을 그대로 쓴다
function shortCategory(category) {
  if (typeof category !== 'string') {
    return '';
  }
  return category.replace(/^음식점( > )?/, '');
}

// 고른 가게를 sessionStorage에 넣고 작성 화면으로 간다 (docs/api.md)
// address는 저장하지 않는 값이라 넘기지 않는다
function selectPlace(place) {
  const selected = {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
  };
  sessionStorage.setItem('selectedPlace', JSON.stringify(selected));
  location.href = REVIEW_PAGE;
}

// 요즘 많이 먹는 메뉴를 순위와 같이 버튼으로 보여 준다. 누르면 그 메뉴로 검색한다.
// 서버가 지금 시간대(slot)를 주면 그 시간대에 많이 먹는 메뉴라서 제목을 "점심에 많이 먹는 메뉴"처럼 바꾼다.
// 불러오지 못하거나 기록이 없으면 칸을 숨긴 채로 둔다
async function loadTrends() {
  try {
    const res = await fetch('/api/trends');
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data.menus) || data.menus.length === 0) {
      return;
    }

    const slotLabel = data.slot && typeof data.slot.label === 'string' ? data.slot.label : '';
    if (slotLabel !== '') {
      trendTitle.textContent = slotLabel + '에 많이 먹는 메뉴';
    }

    data.menus.forEach((menu, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'trend-chip';
      const rank = document.createElement('span');
      rank.className = 'trend-rank';
      rank.textContent = index + 1 + '위';
      chip.append(rank, ' ' + menu.name);
      chip.title = '최근 ' + data.days + '일 동안 ' + (slotLabel !== '' ? slotLabel + '에 쓴 ' : '') + menu.count + '개의 한 줄 추천에 나온 메뉴';
      chip.addEventListener('click', () => {
        input.value = menu.name;
        searchPlaces(menu.name);
      });
      trendList.append(chip);
    });
    trendsBox.hidden = false;
  } catch (err) {
    // 못 불러와도 검색은 그대로 쓸 수 있다
  }
}

loadTrends();
