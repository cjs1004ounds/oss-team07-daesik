// 서버를 시작하는 파일. npm start가 이 파일을 실행한다.

// .env 파일의 값을 process.env로 읽어 온다. 파일이 없어도 오류는 나지 않는다
require('dotenv').config({ quiet: true });

const app = require('./app');
const store = require('./store');

const PORT = process.env.PORT || 3000;

// 저장된 가게와 한 줄 추천을 파일에서 읽어 온다
store.load();

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
