// Express 앱을 만들어서 내보내는 파일.
// 포트를 여는 건 index.js가 한다. 테스트에서 앱만 불러 쓰려고 나눠 뒀다.

const path = require('path');
const express = require('express');

const configRouter = require('./routes/config');
const healthRouter = require('./routes/health');
const placesRouter = require('./routes/places');
const reviewsRouter = require('./routes/reviews');

const app = express();

// 응답에 "X-Powered-By: Express" 헤더를 붙이지 않는다.
// 어떤 프레임워크를 쓰는지 밖에 알려 줄 필요가 없다
app.disable('x-powered-by');

// 요청 본문의 JSON을 req.body로 읽는다
app.use(express.json());

// public 폴더의 HTML, CSS, JavaScript를 그대로 내려준다
app.use(express.static(path.join(__dirname, '..', 'public')));

// API 경로. 새 API는 routes 폴더에 파일을 만들고 여기에 한 줄 추가한다
app.use('/api/health', healthRouter);
app.use('/api/config', configRouter);
app.use('/api/places', placesRouter);
app.use('/api/reviews', reviewsRouter);

// 없는 API 경로로 오면 JSON으로 404를 돌려준다
app.use('/api', (req, res) => {
  res.status(404).json({ error: '없는 경로입니다.' });
});

// 처리 중에 오류가 나도 서버가 죽지 않게 여기서 받는다
app.use((err, req, res, next) => {
  // 요청 본문의 JSON이 깨져 있으면 express.json()이 status 400인 오류를 넘겨준다
  if (err.status === 400) {
    res.status(400).json({ error: '요청 형식이 잘못됐습니다.' });
    return;
  }

  // 요청 본문이 너무 크면(기본 100KB 초과) express.json()이 status 413인 오류를 넘겨준다
  if (err.status === 413) {
    res.status(413).json({ error: '요청이 너무 큽니다.' });
    return;
  }

  console.error(err);
  res.status(500).json({ error: '서버에서 오류가 났습니다.' });
});

module.exports = app;
