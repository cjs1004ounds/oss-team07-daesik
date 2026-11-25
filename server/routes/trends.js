const express = require('express');

const llm = require('../llm');
const store = require('../store');
const { TREND_DAYS, buildMenuPrompt, parseMenus, reviewsToExtract, trendingMenus } = require('../../shared/menuTrends');

const router = express.Router();

// 화면을 여는 동안 기다리는 일이라 오래 기다리지 않는다
const MENU_TIMEOUT_MS = 5000;

// 메뉴 뽑기를 동시에 두 번 하지 않게, 하는 중인 것을 들고 있는다
let extracting = null;

// 아직 메뉴를 뽑지 않은 최근 추천에서 LLM으로 메뉴를 뽑아 저장한다.
// 실패하면 표시하지 않고 넘어가서 다음에 다시 뽑는다
async function extractPendingMenus(clientKey) {
  const pending = reviewsToExtract(store.getReviews(), Date.now());
  if (pending.length === 0) {
    return;
  }

  try {
    const ids = pending.map((review) => review.id);
    const raw = await llm.generateJson(buildMenuPrompt(pending), { timeoutMs: MENU_TIMEOUT_MS, clientKey: clientKey });
    const result = parseMenus(raw, ids);
    if (!result.ok) {
      console.error('메뉴 뽑기 응답을 쓸 수 없습니다: ' + result.error);
      return;
    }
    for (const id of ids) {
      store.setReviewMenus(id, result.value[id]);
    }
  } catch (err) {
    console.error('메뉴 뽑기 실패: ' + err.message);
  }
}

// GET /api/trends
// 요즘 많이 먹는 메뉴. 최근 14일 동안 메뉴마다 몇 개의 추천에 나왔는지 센다.
// 메뉴 이름은 LLM이 한 줄 추천에서 뽑아 두고, 세는 것은 규칙(shared/menuTrends.js)이 한다
router.get('/', async (req, res) => {
  if (!extracting) {
    extracting = extractPendingMenus(req.ip).finally(() => {
      extracting = null;
    });
  }
  await extracting;

  res.json({ days: TREND_DAYS, menus: trendingMenus(store.getReviews(), store.getPlaces(), Date.now()) });
});

module.exports = router;
