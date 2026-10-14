## 문제

평가 시험에서 통과 기준 미달로 ‘다시 도전’이 표시되어도 포석호가 웃고 통통 뛰어 결과와 감정 표현이 맞지 않는다.

## 근거

`frontend/login_ui/exam.js`는 미통과 완료 결과를 `motionFor('result', { unlocked: false })`로 전달한다. `checkpoint-chat.js`는 `cheer_retry`를 반환하고, `cp-face.js`는 이를 `determined`로 매핑한다. `drawFace`의 determined 분기는 `smile(10, 46)`을 그린다. `cp-character.js`의 cheer_retry는 반복 점프다.

## 변경 범위

- 미통과 완료는 차분한 아쉬움/응원 표정과 동작을 적용한다.
- 정답과 통과의 웃음·축하 동작은 유지한다.
- 완료 화면의 통과/재도전 전환과 복원에서 같은 규칙을 적용한다.

## 완료 기준

- 재도전 화면에서 미소와 축하 효과가 보이지 않는다.
- 통과 화면은 축하 표정으로 표시된다.
- 실제 완료 데이터 또는 명시적 UI fixture로 두 상태를 브라우저에서 비교하고 회귀 테스트를 추가한다.

관련: 평가 시험 `/exam`.
