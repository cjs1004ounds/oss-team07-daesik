const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateReviewInput, ALLOWED_TAGS } = require('../shared/reviewValidator');

describe('R6 한 줄 추천 입력값 검증', () => {
  // 1. 정상 입력 테스트
  it('모든 필드가 정상 범위일 때 정규화된 값을 반환한다', () => {
    const result = validateReviewInput({
      text: '  제육 7천원인데 양 많음 혼밥하기 좋음  ',
      price: 7000,
      tags: ['양 많음', '혼밥']
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      text: '제육 7천원인데 양 많음 혼밥하기 좋음',
      price: 7000,
      tags: ['양 많음', '혼밥']
    });
  });

  it('가격을 비워 두고(null, undefined, 빈 문자열) 태그가 없어도 통과한다', () => {
    const resNull = validateReviewInput({ text: '점심시간에 가기 좋아요', price: null });
    const resUndef = validateReviewInput({ text: '점심시간에 가기 좋아요' });
    const resEmpty = validateReviewInput({ text: '점심시간에 가기 좋아요', price: '' });

    assert.equal(resNull.ok, true);
    assert.equal(resNull.value.price, null);
    assert.deepEqual(resNull.value.tags, []);

    assert.equal(resUndef.ok, true);
    assert.equal(resUndef.value.price, null);

    assert.equal(resEmpty.ok, true);
    assert.equal(resEmpty.value.price, null);
  });

  it('README에 정의된 8개 허용 태그는 모두 통과한다', () => {
    for (const tag of ALLOWED_TAGS) {
      const result = validateReviewInput({
        text: '허용 태그 개별 검증 테스트',
        tags: [tag]
      });
      assert.equal(result.ok, true, `태그 '${tag}'는 통과해야 합니다.`);
    }
  });

  // 2. 경계값 테스트
  it('문장 길이 경계값(5자, 100자)은 통과하고 4자, 101자는 실패한다', () => {
    assert.equal(validateReviewInput({ text: '가나다라마' }).ok, true);
    assert.equal(validateReviewInput({ text: '가'.repeat(100) }).ok, true);

    assert.equal(validateReviewInput({ text: '가나다라' }).ok, false);
    assert.equal(validateReviewInput({ text: '     ' }).ok, false);
    assert.equal(validateReviewInput({ text: '    가나다라    ' }).ok, false);
    assert.equal(validateReviewInput({ text: '가'.repeat(101) }).ok, false);
  });

  it('가격 경계값(1000, 100000)은 통과하고 999, 100001은 실패한다', () => {
    assert.equal(validateReviewInput({ text: '천원 메뉴 추천합니다', price: 1000 }).ok, true);
    assert.equal(validateReviewInput({ text: '십만원 코스 추천합니다', price: 100000 }).ok, true);

    assert.equal(validateReviewInput({ text: '경계값 미만 가격 테스트', price: 999 }).ok, false);
    assert.equal(validateReviewInput({ text: '경계값 초과 가격 테스트', price: 100001 }).ok, false);
  });

  it('태그는 0개~3개까지 통과하고 4개부터 실패한다', () => {
    assert.equal(validateReviewInput({ text: '태그 0개 테스트', tags: [] }).ok, true);
    assert.equal(
      validateReviewInput({ text: '태그 3개 테스트', tags: ['양 많음', '혼밥', '가성비'] }).ok,
      true
    );
    assert.equal(
      validateReviewInput({
        text: '태그 4개 테스트',
        tags: ['양 많음', '혼밥', '가성비', '빨리 나옴']
      }).ok,
      false
    );
  });

  // 3. 잘못된 입력 테스트
  it('입력 객체나 text 타입이 잘못되면 실패한다', () => {
    assert.equal(validateReviewInput(null).ok, false);
    assert.equal(validateReviewInput([]).ok, false);
    assert.equal(validateReviewInput({ text: 12345 }).ok, false);
    assert.equal(validateReviewInput({}).ok, false);
  });

  it('가격이 정수가 아니거나 숫자 타입이 아니면 실패한다', () => {
    assert.equal(validateReviewInput({ text: '소수점 가격 테스트', price: 7500.5 }).ok, false);
    assert.equal(validateReviewInput({ text: '문자열 가격 테스트', price: '7000' }).ok, false);
    assert.equal(validateReviewInput({ text: 'NaN 가격 테스트', price: Number.NaN }).ok, false);
    assert.equal(validateReviewInput({ text: '음수 가격 테스트', price: -5000 }).ok, false);
  });

  it('목록에 없는 태그, 중복 태그, 배열이 아닌 tags는 실패한다', () => {
    assert.equal(
      validateReviewInput({ text: '없는 태그 테스트', tags: ['친절함'] }).ok,
      false
    );
    assert.equal(
      validateReviewInput({ text: '중복 태그 테스트', tags: ['혼밥', '혼밥'] }).ok,
      false
    );
    assert.equal(
      validateReviewInput({ text: '잘못된 태그 타입', tags: '혼밥' }).ok,
      false
    );
  });
});