# 프론트 변경과 백엔드·에이전트 검증

프론트 수정 때마다 백엔드나 에이전트를 새로 연결할 필요는 없다. 서버가 같은 API를 제공하고 프론트가 그 요청 계약을 유지하면 연결은 계속 동작한다. 서로 다른 worktree에서 작업한 변경은 **실제 시연 서버의 실행 폴더에 통합**해야 화면에 반영된다.

## 변경별 확인 범위

| 변경 | 필요한 확인 |
|---|---|
| 색·폰트·여백·이미지·카드 배치 | 데스크톱/모바일 화면, 입력창/버튼 가시성. 모델 호출 불필요 |
| 화면 이동·DOM ID·이벤트·공정/설비 선택 | 브라우저에서 버튼·선택 맥락·로그인·새로고침 확인. 모델 호출 없이 검사 가능 |
| API 주소·요청/응답 필드·JWT·시험 작업/상태 | 프론트와 서버를 함께 실행하고 HTTP·브라우저 통합 검사 |
| RAG 자료·프롬프트·모델·루브릭·채점 | 결정적 테스트와 실제 모델 평가. 기능 연결 성공과 답변/채점 정확도는 구분 |

바닐라 HTML/CSS/JS는 실행 중 서버가 `frontend/`에서 직접 서빙한다. 실행 폴더 안 정적 파일의 수정은 브라우저 새로고침으로 반영된다. TypeScript 백엔드 변경은 빌드와 서버 재시작이 필요하다. 개발 브랜치에서 화면을 고쳐도 다른 폴더에서 실행 중인 서버에는 자동으로 옮겨지지 않는다.

## 반복 가능한 검사 명령

별도 QA DB를 사용하는 Gemini 서버를 3013에서 실행한다. 실제 사용자 DB에 QA 계정과 오답 시험을 만들지 않는다.

```powershell
$env:PORT = "3013"
$env:DB_PATH = "data/qa-retry.sqlite"
$env:ANSWER_CACHE_PATH = "data/qa-retry-cache.json"
$env:WARM_ANSWERS = "off"
npm run start:gemini
```

다른 터미널에서 Playwright 도구를 설치하고 화면 연결을 검사한다. 아래 기본 검사는 모델을 호출하지 않는다.

```powershell
npm install --prefix data/browser-tools playwright --no-package-lock --ignore-scripts
$env:DEMO_QA_URL = "http://127.0.0.1:3013"
npm run check:ui
```

실제 학습 답변까지 확인할 필요가 있을 때만 `$env:DEMO_QA_LLM = "on"`으로 실행한다. 캐시가 비어 있는 별도 QA DB/답변 캐시에서 사용한다. 캐시가 채워져 있으면 기존 답변을 확인할 수 있으므로 모델 자체의 속도 평가는 별도 스크립트를 쓴다.

시험과 포석호 재도전의 실제 흐름:

```powershell
$env:RETRY_QA_URL = "http://127.0.0.1:3013"
npm run check:exam-retry
```

이 검사는 Gemini로 오답 → 설명 → 재확인 → 미통과 완료를 만든다. 실제 완료 화면의 표정과 새로고침 복원, 재도전 버튼, 재도전 첫 문제를 확인한다. 모델 호출이 발생한다. 로컬 Chromium 설치 경로는 각 검사 스크립트에서 환경에 맞게 지정한다.

## 2026-10-14 최신 통합 결과

- `origin/dev`의 `ea90f2f`와 개발 중인 PR #144(`design/brand-orange`, `56d617f`)를 시연 브랜치 `integrate/demo-latest`에 통합했다. 원격 dev/PR을 직접 병합한 것은 아니다.
- 새 대시보드 보기·주황색 HUD·고정 크기 재생 바·도입 화면을 기존 Gemini와 마이페이지 질문 연결에 통합했다.
- 모바일 상단 바의 기존 가운데 정렬 transform과 새 좌우 고정 위치가 겹치는 문제를 정리했다. 동작 축소 설정에서도 전환이 멈춘다.
- 전체 자동 테스트 **367개 통과**.
- 이슈 #141 재검증: 실제 Gemini 오답 6턴 → 0점/미통과 → 아쉬운 포석호 표정 → 새로고침 유지 → 새 `kind=retry` 시험 → `awaiting_answer` 첫 문제. 총 54초. QA 계정에서 실행했고 실제 사용자 점수는 변경하지 않았다.

근거: [미통과 화면](screenshots/retry-live/failed-result.png), [재도전 첫 문제](screenshots/retry-live/retry-question.png), [검증 결과 JSON](screenshots/retry-live/result.json).
