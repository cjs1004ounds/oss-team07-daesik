// 시드 데이터 만들기. 팀이 채운 입력 파일을 읽어 data/seed의 파일 세 개를 만든다 (docs/seed.md).
//   실행: npm run seed            (입력 파일은 data/seed-input.json)
//         npm run seed -- 다른파일.json
//         npm run seed -- 다른파일.json 다른폴더   (data/seed 말고 다른 곳에 써서 미리 볼 때)
// 가게 이름으로 카카오에서 가게 번호, 좌표, 분류를 찾아 붙인다. 그래서 .env에 KAKAO_REST_API_KEY가 있어야 한다.
// 입력에 틀린 곳이 하나라도 있으면 무엇이 틀렸는지 모두 보여 주고 파일은 쓰지 않는다.

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const kakao = require('../server/kakao');
const { walkMinutes, isWithinWalk } = require('../shared/placeFilter');
const { validateItem, findDuplicates, choosePlace, buildSeed } = require('./seedRules');

const ROOT = path.join(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'data', 'seed-input.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'seed');

function stop(messages) {
  for (const message of messages) {
    console.error(message);
  }
  console.error('시드 파일은 바꾸지 않았습니다.');
  process.exit(1);
}

async function main() {
  const inputFile = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT;
  const outputDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT;
  if (!fs.existsSync(inputFile)) {
    stop(['입력 파일이 없습니다: ' + inputFile, 'data/seed-input.example.json을 복사해서 채워 주세요.']);
  }

  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  } catch (err) {
    stop(['입력 파일이 JSON이 아닙니다: ' + err.message]);
  }
  if (!Array.isArray(input) || input.length === 0) {
    stop(['입력 파일은 기록을 하나 이상 담은 배열이어야 합니다.']);
  }

  // 1. 한 줄씩 검사한다
  const now = Date.now();
  const items = [];
  const errors = [];
  input.forEach((item, index) => {
    const result = validateItem(item, index + 1, now);
    if (result.ok) {
      items.push(result.value);
    } else {
      errors.push(result.error);
    }
  });
  if (errors.length > 0) {
    stop(errors);
  }
  const duplicates = findDuplicates(items);
  if (duplicates.length > 0) {
    stop(duplicates);
  }

  // 2. 가게 이름마다 카카오에서 한 번씩 찾는다. 같은 가게는 다시 찾지 않는다
  const found = new Map();
  for (const item of items) {
    const key = item.place + '|' + (item.placeId || '');
    if (found.has(key)) {
      continue;
    }
    let candidates;
    try {
      candidates = await kakao.searchPlaces(item.place);
    } catch (err) {
      stop(['카카오 검색에 실패했습니다: ' + err.message]);
    }
    const chosen = choosePlace(item.place, item.placeId, candidates);
    if (chosen.ok) {
      found.set(key, chosen.place);
    } else {
      errors.push(chosen.error);
      found.set(key, null);
    }
  }
  if (errors.length > 0) {
    stop(errors);
  }

  // 3. 파일 세 개를 만든다
  const seed = buildSeed(items, (item) => found.get(item.place + '|' + (item.placeId || '')));
  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of ['places', 'reviews', 'visits']) {
    fs.writeFileSync(path.join(outputDir, name + '.json'), JSON.stringify(seed[name], null, 2) + '\n');
  }

  console.log('가게 ' + seed.places.length + '곳, 한 줄 추천 ' + seed.reviews.length + '개, 다녀왔어요 ' + seed.visits.length + '개를 ' + outputDir + '에 썼습니다.');
  for (const place of seed.places) {
    const minutes = walkMinutes(place);
    const note = isWithinWalk(minutes) ? '' : '  <- 걸어서 15분이 넘어 지도 목록에는 나오지 않습니다';
    console.log('- ' + place.name + ' (걸어서 ' + minutes + '분)' + note);
  }
}

main();
