// 같이 정하기 화면.
// 주소에 code가 없으면 방 만들기, /room.html?code=방코드 면 그 방을 보여 준다.
// 실시간 통신은 쓰지 않고 5초마다 GET /api/rooms/:code 를 다시 불러 표 수를 갱신한다 (docs/api.md "같이 정하기 방")

const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 6;
const POLL_MS = 5000;

const roomCode = new URLSearchParams(location.search).get('code');

// ---------- 브라우저에 기억해 두는 값 ----------
// 서버는 누가 어디에 투표했는지, 누가 방을 만들었는지 돌려주지 않는다.
// 그래서 내가 만든 방(myRooms), 내 표(roomVotes), 다녀왔어요를 남긴 방(roomVisited)은 브라우저에 둔다

function readSaved(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value === null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

function writeSaved(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // 저장소를 못 쓰는 브라우저면 기억만 못 하고 나머지는 그대로 된다
  }
}

// "음식점 > 일식 > 돈까스,우동" -> "일식 > 돈까스,우동". 맨 앞의 "음식점"은 모든 가게가 같아서 뺀다
function shortCategory(category) {
  if (typeof category !== 'string') {
    return '';
  }
  return category.replace(/^음식점( > )?/, '');
}

// 가게 이름과 분류를 두 줄로 담은 칸. 값은 textContent로 넣어서 HTML로 해석되지 않게 한다
function makePlaceBlock(name, category) {
  const block = document.createElement('span');
  block.className = 'room-place';

  const nameEl = document.createElement('strong');
  nameEl.textContent = name;

  const categoryEl = document.createElement('span');
  categoryEl.className = 'sub';
  categoryEl.textContent = shortCategory(category);

  block.append(nameEl, categoryEl);
  return block;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data: data };
}

if (roomCode) {
  startRoom();
} else {
  startCreate();
}

// ---------- 방 만들기 ----------

function startCreate() {
  document.getElementById('create-view').hidden = false;

  const form = document.getElementById('candidate-search-form');
  const askForm = document.getElementById('ask-form');
  const askInput = document.getElementById('ask-input');
  const askButton = document.getElementById('ask-button');
  const input = document.getElementById('candidate-search-input');
  const searchButton = document.getElementById('candidate-search-button');
  const searchMessage = document.getElementById('candidate-search-message');
  const searchResults = document.getElementById('candidate-search-results');
  const candidateList = document.getElementById('candidate-list');
  const candidateCount = document.getElementById('candidate-count');
  const candidateEmpty = document.getElementById('candidate-empty');
  const createButton = document.getElementById('create-button');
  const createMessage = document.getElementById('create-message');

  // 고른 후보. 검색 결과의 가게 모양 그대로 둔다. 배열 순서가 후보에 오른 순서다
  const candidates = [];
  // 마지막 검색 결과. 후보를 넣고 뺄 때 버튼 상태를 다시 그리려고 들고 있다
  let lastResults = [];

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query === '') {
      return;
    }

    searchButton.disabled = true;
    searchMessage.textContent = '찾는 중입니다.';
    try {
      const res = await fetch('/api/places/search?q=' + encodeURIComponent(query));
      const data = await res.json();
      if (!res.ok) {
        searchMessage.textContent = data.error || '검색하지 못했습니다.';
        lastResults = [];
      } else if (data.places.length === 0) {
        searchMessage.textContent = '찾은 가게가 없습니다. 다른 검색어로 해 보세요.';
        lastResults = [];
      } else {
        searchMessage.textContent = '후보로 넣을 가게의 넣기를 눌러 주세요.';
        lastResults = data.places;
      }
    } catch (err) {
      searchMessage.textContent = '서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.';
      lastResults = [];
    } finally {
      searchButton.disabled = false;
    }
    drawCreate();
  });

  // 말로 후보 찾기. LLM이 말을 필터로 바꾸고, 기록이 있는 가게 중에서 거른 결과를 검색 결과 자리에 보여 준다
  askForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = askInput.value.trim();
    if (question === '') {
      return;
    }

    askButton.disabled = true;
    searchMessage.textContent = '말을 필터로 바꾸는 중입니다.';
    try {
      const result = await postJson('/api/places/ask', { question: question });
      if (!result.ok) {
        searchMessage.textContent = result.data.error || '찾지 못했습니다.';
        lastResults = [];
      } else if (result.data.message) {
        searchMessage.textContent = result.data.message;
        lastResults = [];
      } else {
        const filterText = describeFilter(result.data.filter);
        lastResults = result.data.places;
        searchMessage.textContent = lastResults.length === 0
          ? filterText + '에 맞는 기록 있는 가게가 없습니다. 아래에서 직접 검색해 보세요.'
          : filterText + '로 찾은 기록 있는 가게입니다.';
      }
    } catch (err) {
      searchMessage.textContent = '서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.';
      lastResults = [];
    } finally {
      askButton.disabled = false;
    }
    drawCreate();
  });

  createButton.addEventListener('click', async () => {
    createButton.disabled = true;
    createMessage.textContent = '방을 만드는 중입니다.';
    try {
      const result = await postJson('/api/rooms', {
        anonId: getOrCreateAnonId(),
        candidates: candidates.map((place) => ({
          id: place.id,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          category: place.category,
        })),
      });
      if (!result.ok) {
        createMessage.textContent = result.data.error || '방을 만들지 못했습니다.';
        createButton.disabled = false;
        return;
      }

      // 내가 만든 방으로 기억해 두면 방 화면에서 링크와 마감 버튼이 보인다
      const myRooms = readSaved('myRooms', []);
      myRooms.push(result.data.room.code);
      writeSaved('myRooms', myRooms);
      location.href = '/room.html?code=' + encodeURIComponent(result.data.room.code);
    } catch (err) {
      createMessage.textContent = '서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.';
      createButton.disabled = false;
    }
  });

  function isPicked(place) {
    return candidates.some((candidate) => candidate.id === place.id);
  }

  // 검색 결과와 고른 후보를 다시 그린다
  function drawCreate() {
    searchResults.replaceChildren();
    for (const place of lastResults) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      if (isPicked(place)) {
        button.textContent = '넣음';
        button.disabled = true;
      } else {
        button.textContent = '넣기';
        button.disabled = candidates.length >= MAX_CANDIDATES;
        button.addEventListener('click', () => {
          candidates.push(place);
          drawCreate();
        });
      }
      item.append(makePlaceBlock(place.name, place.category), button);
      searchResults.append(item);
    }

    candidateList.replaceChildren();
    for (const place of candidates) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = '빼기';
      button.addEventListener('click', () => {
        candidates.splice(candidates.indexOf(place), 1);
        drawCreate();
      });
      item.append(makePlaceBlock(place.name, place.category), button);
      candidateList.append(item);
    }

    candidateCount.textContent = candidates.length + ' / ' + MAX_CANDIDATES;
    candidateEmpty.hidden = candidates.length > 0;
    createButton.disabled = candidates.length < MIN_CANDIDATES;
    if (candidates.length === 1) {
      createMessage.textContent = '한 곳만 더 고르면 방을 만들 수 있습니다.';
    } else if (candidates.length >= MAX_CANDIDATES) {
      createMessage.textContent = '후보는 ' + MAX_CANDIDATES + '곳까지 고를 수 있습니다.';
    } else {
      createMessage.textContent = '';
    }
  }

  drawCreate();
}

// 말로 찾기가 만든 필터를 사람이 읽는 말로. 예: "1인 8,000원 이하, 혼밥"
function describeFilter(filter) {
  const parts = [];
  if (filter.maxPrice) {
    parts.push('1인 ' + filter.maxPrice.toLocaleString('ko-KR') + '원 이하');
  }
  if (filter.category) {
    parts.push(filter.category);
  }
  if (filter.tags && filter.tags.length > 0) {
    parts.push(filter.tags.join(', '));
  }
  if (filter.maxWalk) {
    parts.push('걸어서 ' + filter.maxWalk + '분 안');
  }
  return parts.join(', ');
}

// ---------- 방 ----------

function startRoom() {
  document.getElementById('room-view').hidden = false;

  const codeEl = document.getElementById('room-code');
  const shareBox = document.getElementById('share-box');
  const shareLink = document.getElementById('share-link');
  const copyButton = document.getElementById('copy-button');
  const statusEl = document.getElementById('room-status');
  const voteList = document.getElementById('vote-list');
  const closeButton = document.getElementById('close-button');
  const visitBox = document.getElementById('visit-box');
  const againButton = document.getElementById('again-button');
  const mehButton = document.getElementById('meh-button');
  const visitMessage = document.getElementById('visit-message');
  const roomMessage = document.getElementById('room-message');

  let room = null;
  let pollTimer = null;
  // 투표나 마감 요청을 보내는 중에는 버튼을 막는다
  let busy = false;

  const isMine = readSaved('myRooms', []).includes(roomCode.toUpperCase());

  shareLink.value = location.origin + '/room.html?code=' + encodeURIComponent(roomCode.toUpperCase());

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareLink.value);
      copyButton.textContent = '복사함';
    } catch (err) {
      // 복사 기능을 못 쓰는 브라우저면 글자를 골라 두고 직접 복사하게 한다
      shareLink.select();
      roomMessage.textContent = '링크를 길게 눌러 복사해 주세요.';
    }
  });

  closeButton.addEventListener('click', async () => {
    if (!confirm('마감하면 더 투표할 수 없습니다. 마감할까요?')) {
      return;
    }
    await send(() => postJson('/api/rooms/' + encodeURIComponent(roomCode) + '/close', { anonId: getOrCreateAnonId() }));
  });

  againButton.addEventListener('click', () => sendVisit(true));
  mehButton.addEventListener('click', () => sendVisit(false));

  loadRoom();
  pollTimer = setInterval(() => {
    // 다른 탭을 보고 있을 때는 부르지 않는다
    if (!document.hidden) {
      loadRoom();
    }
  }, POLL_MS);

  async function loadRoom() {
    try {
      const res = await fetch('/api/rooms/' + encodeURIComponent(roomCode));
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = data.error || '방을 불러오지 못했습니다.';
        voteList.replaceChildren();
        stopPolling();
        return;
      }
      // 표 수가 그대로면 다시 그리지 않는다. 누르려던 버튼이 새로 만들어지면 클릭이 빗나갈 수 있다
      if (room && JSON.stringify(room) === JSON.stringify(data.room)) {
        return;
      }
      room = data.room;
      drawRoom();
    } catch (err) {
      statusEl.textContent = '서버에 연결하지 못했습니다. 잠시 뒤에 다시 불러옵니다.';
    }
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // 투표나 마감 요청을 보내고, 돌려받은 방으로 다시 그린다
  async function send(request) {
    if (busy) {
      return null;
    }
    busy = true;
    roomMessage.textContent = '';
    try {
      const result = await request();
      if (result.ok) {
        room = result.data.room;
      } else {
        roomMessage.textContent = result.data.error || '요청을 처리하지 못했습니다.';
        // 그 사이에 마감됐을 수 있어서 방을 다시 불러온다
        await loadRoom();
      }
      return result;
    } catch (err) {
      roomMessage.textContent = '서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.';
      return null;
    } finally {
      busy = false;
      if (room) {
        drawRoom();
      }
    }
  }

  async function vote(placeId) {
    const result = await send(() => postJson('/api/rooms/' + encodeURIComponent(roomCode) + '/votes', {
      anonId: getOrCreateAnonId(),
      placeId: placeId,
    }));
    if (result && result.ok) {
      const votes = readSaved('roomVotes', {});
      votes[room.code] = placeId;
      writeSaved('roomVotes', votes);
      drawRoom();
    }
  }

  function drawRoom() {
    codeEl.textContent = room.code;
    const myVote = readSaved('roomVotes', {})[room.code];
    const winner = room.candidates.find((candidate) => candidate.placeId === room.winnerId);

    if (room.closed) {
      statusEl.textContent = winner
        ? '마감됐습니다. 정해진 가게는 ' + winner.name + '입니다.'
        : '마감된 방입니다.';
      stopPolling();
    } else {
      statusEl.textContent = '지금까지 ' + room.totalVotes + '표입니다. 가게를 골라 투표해 주세요. 다시 고르면 표가 바뀝니다.';
    }

    // 막대 길이는 가장 많이 받은 표를 꽉 찬 길이로 본다
    let maxVotes = 1;
    for (const candidate of room.candidates) {
      maxVotes = Math.max(maxVotes, candidate.votes);
    }

    voteList.replaceChildren();
    for (const candidate of room.candidates) {
      const item = document.createElement('li');
      if (candidate.placeId === myVote) {
        item.classList.add('is-mine');
      }
      if (candidate.placeId === room.winnerId) {
        item.classList.add('is-winner');
      }

      const block = makePlaceBlock(candidate.name, candidate.category);
      const count = document.createElement('span');
      count.className = 'sub';
      count.textContent = candidate.votes + '표' + (candidate.placeId === myVote ? ' (내 표)' : '');
      const bar = document.createElement('span');
      bar.className = 'vote-bar';
      const fill = document.createElement('span');
      fill.style.width = Math.round((candidate.votes / maxVotes) * 100) + '%';
      bar.append(fill);
      block.append(count, bar);
      item.append(block);

      if (!room.closed) {
        const button = document.createElement('button');
        button.type = 'button';
        if (candidate.placeId === myVote) {
          button.textContent = '투표함';
          button.className = 'secondary';
          button.disabled = true;
        } else {
          button.textContent = '투표';
          button.disabled = busy;
          button.addEventListener('click', () => vote(candidate.placeId));
        }
        item.append(button);
      }

      voteList.append(item);
    }

    shareBox.hidden = !isMine || room.closed;
    closeButton.hidden = !isMine || room.closed;
    closeButton.disabled = busy || room.totalVotes === 0;

    const visited = readSaved('roomVisited', {})[room.code];
    visitBox.hidden = !room.closed || !winner;
    againButton.hidden = Boolean(visited);
    mehButton.hidden = Boolean(visited);
    if (visited && visitMessage.textContent === '') {
      visitMessage.textContent = '이 방에서는 이미 남겼습니다.';
    }
  }

  // 마감 뒤 "또 갈래요"(true) 또는 "글쎄요"(false). 정해진 가게로 남긴다
  async function sendVisit(again) {
    const winner = room.candidates.find((candidate) => candidate.placeId === room.winnerId);
    if (!winner) {
      return;
    }

    againButton.disabled = true;
    mehButton.disabled = true;
    visitMessage.textContent = '남기는 중입니다.';
    try {
      const result = await postJson('/api/visits', {
        place: {
          id: winner.placeId,
          name: winner.name,
          lat: winner.lat,
          lng: winner.lng,
          category: winner.category,
        },
        again: again,
        anonId: getOrCreateAnonId(),
        roomCode: room.code,
      });

      // 409는 오늘 이미 이 가게에 남긴 경우다. 다시 누를 필요가 없으니 남긴 것으로 친다
      if (result.ok || result.status === 409) {
        const visitedRooms = readSaved('roomVisited', {});
        visitedRooms[room.code] = true;
        writeSaved('roomVisited', visitedRooms);
        visitMessage.textContent = result.ok
          ? '남겼습니다. 지도에서 이 가게를 볼 수 있습니다.'
          : result.data.error;
        drawRoom();
        return;
      }
      visitMessage.textContent = result.data.error || '남기지 못했습니다.';
    } catch (err) {
      visitMessage.textContent = '서버에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요.';
    }
    againButton.disabled = false;
    mehButton.disabled = false;
  }
}
