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

// 검색어로 학교 근처 음식점을 찾아 배열로 돌려준다.
// 키가 없거나 카카오 호출이 실패하면 오류를 던진다. 받는 쪽에서 502로 바꾼다
async function searchPlaces(query) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    throw new Error('KAKAO_REST_API_KEY가 없습니다.');
  }

  const params = new URLSearchParams({
    query: query,
    category_group_code: 'FD6', // 음식점만
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
  return data.documents.map(toPlace);
}

module.exports = {
  SEARCH_CENTER,
  SEARCH_RADIUS_M,
  toPlace,
  searchPlaces,
};
