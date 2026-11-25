// 카카오 로컬 API(키워드로 장소 검색)를 부르는 파일.
// 문서: https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-keyword

const KAKAO_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';

// 검색 가운데. 카카오에서 찾은 광운대학교 위치다. 첫 화면 지도(public/js/map.js)와 같은 값을 쓴다.
// 학교 기준점은 아직 팀에서 못 정해서 임시로 넣은 값이다 (README "아직 못 정한 것")
const SEARCH_CENTER = { lat: 37.61924, lng: 127.05827 };

// 검색 반경. 도보 15분(R2)이 직선으로 약 1km라서 거기에 맞췄다.
// 더 넓게 찾으면 기록을 남겨도 지도에 안 나오는 가게가 검색된다
const SEARCH_RADIUS_M = 1000;

// 카카오가 주는 장소 하나를 우리가 쓰는 모양으로 바꾼다 (docs/api.md)
// 카카오는 경도를 x, 위도를 y에 문자열로 준다
function toPlace(document) {
  return {
    id: document.id,
    name: document.place_name,
    lat: Number(document.y),
    lng: Number(document.x),
    category: document.category_name,
    address: document.road_address_name || document.address_name,
  };
}

// 찾는 카카오 분류. 음식점(FD6)과 카페(CE7)
const CATEGORY_CODES = ['FD6', 'CE7'];

// 두 분류를 합친 뒤 이 개수까지만 돌려준다
const MAX_RESULTS = 20;

// 분류 하나로 카카오에 검색해서 카카오가 준 장소 목록을 그대로 돌려준다
async function searchCategory(key, query, categoryCode) {
  const params = new URLSearchParams({
    query: query,
    category_group_code: categoryCode,
    x: String(SEARCH_CENTER.lng),
    y: String(SEARCH_CENTER.lat),
    radius: String(SEARCH_RADIUS_M),
    size: '15',
  });

  const res = await fetch(`${KAKAO_URL}?${params}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });

  if (!res.ok) {
    throw new Error(`카카오 API 응답이 ${res.status}입니다.`);
  }

  const data = await res.json();
  return data.documents;
}

// 검색어로 학교 근처 음식점과 카페를 찾아 배열로 돌려준다.
// 두 분류를 같이 찾아서 학교에서 가까운 순으로 합친다. 카페는 음식점 분류에 없어서 따로 찾아야 한다.
// 키가 없거나 카카오 호출이 실패하면 오류를 던진다. 받는 쪽에서 502로 바꾼다
async function searchPlaces(query) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    throw new Error('KAKAO_REST_API_KEY가 없습니다.');
  }

  const lists = await Promise.all(CATEGORY_CODES.map((code) => searchCategory(key, query, code)));

  // 카카오는 가운데 좌표를 주면 distance(m)를 문자열로 준다. 없으면 가장 먼 것으로 친다
  const documents = lists.flat();
  const distanceOf = (document) => {
    const meters = Number(document.distance);
    return document.distance === '' || Number.isNaN(meters) ? Infinity : meters;
  };
  documents.sort((a, b) => distanceOf(a) - distanceOf(b));

  const seen = new Set();
  const places = [];
  for (const document of documents) {
    if (!seen.has(document.id)) {
      seen.add(document.id);
      places.push(toPlace(document));
    }
  }
  return places.slice(0, MAX_RESULTS);
}

module.exports = {
  CATEGORY_CODES,
  MAX_RESULTS,
  SEARCH_CENTER,
  SEARCH_RADIUS_M,
  toPlace,
  searchPlaces,
};
