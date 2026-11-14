// 첫 화면에서 서버가 살아 있는지 확인해 글자로 보여 준다.
// 뼈대가 잘 붙었는지 보려고 넣은 것이라 지도 화면이 들어오면 지워도 된다.

const statusEl = document.getElementById('server-status');

fetch('/api/health')
  .then((res) => res.json())
  .then((data) => {
    statusEl.textContent = data.status === 'ok' ? '정상' : '이상함';
  })
  .catch(() => {
    statusEl.textContent = '연결 안 됨';
  });
