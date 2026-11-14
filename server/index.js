// 서버를 시작하는 파일. npm start가 이 파일을 실행한다.

// .env 파일의 값을 process.env로 읽어 온다. 파일이 없어도 오류는 나지 않는다
require('dotenv').config({ quiet: true });

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
