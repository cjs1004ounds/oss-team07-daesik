const express = require('express');

const router = express.Router();

// GET /api/config
// 브라우저가 화면을 그릴 때 필요한 설정을 돌려준다.
//
// 카카오맵 JavaScript 키는 브라우저에서 쓰는 값이라 어차피 사용자에게 보인다.
// 그래도 저장소에 적어 두지 않으려고 환경 변수에서 읽어서 넘긴다.
// 여기에는 브라우저에 보여도 되는 값만 넣는다. REST 키 같은 서버용 키는 넣지 않는다
router.get('/', (req, res) => {
  res.json({
    kakaoJsKey: process.env.KAKAO_JS_KEY || '',
  });
});

module.exports = router;
