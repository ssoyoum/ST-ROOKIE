# Gemini 시연과 학습 화면 개편

2026-10-14. `fix/demo-gemini-layout`에서 수정했다. 평가 시험·교육 운영 API·기존 학습 자료는 유지하고, 사용자의 시연 모델과 화면 배치 요청을 반영했다.

## 이슈와 수정

| 이슈 | 수정 |
|---|---|
| [#140 공정 화면](https://github.com/steel-rookie/ST-ROOKIE/issues/140) | `steel-index`의 AI 튜터 버튼·대화 어댑터·자동 질문·입력창을 제거했다. 설비 제목과 패널 아래 버튼을 내용 스크롤에서 분리했다. 상단 공정 선택·하단 재생 바는 고정하고 좁은 화면의 공정/설비 목록은 내부 가로 스크롤을 허용한다. |
| [#141 포석호 표정](https://github.com/steel-rookie/ST-ROOKIE/issues/141) | 미통과 `cheer_retry`의 미소·반복 점프·팝/별 효과를 아쉬운 표정·차분한 호흡·빗방울로 바꿨다. 통과 `celebrate`의 축하 표정은 유지한다. |
| [#142 마이페이지](https://github.com/steel-rookie/ST-ROOKIE/issues/142) | AI 튜터를 모듈 높이에 강제로 맞추던 `alignSide`를 제거했다. 작은 포석호 머리, 독립적인 카드 높이, 대화 영역 내부 스크롤, 고정 입력창으로 재배치했다. 모바일 헤더를 줄이고 학습 기록·평가 링크를 유지한다. |
| [#143 Gemini 시연](https://github.com/steel-rookie/ST-ROOKIE/issues/143) | `npm run start:gemini`로 provider를 Gemini로 명시하고 과거 `PRIVATE_LLM_ONLY=1` 설정과 관계없이 실행한다. 학습·평가·관리자 요약은 기존 공통 provider factory를 사용한다. |

공정 화면의 **마이페이지에서 질문** 버튼은 `p`·`equipment` 쿼리에 현재 선택을 넣는다. 학습자 대시보드는 실제 공정·설비 목록으로 검증하고 그 선택을 2D 모듈과 튜터에 복원한다. 이 버튼은 질문을 자동 전송하지 않는다.

`My Page.dc.html`은 역할별 대시보드의 iframe 진입점이다. 학습자 UI의 실질적인 변경 위치는 `Trainee Dashboard.dc.html`이다. 관리자 화면은 유지한다. 공정 탐색 화면에서 자유 질문 튜터를 제거했으며 평가 시험의 질문·채점·설명 기능은 계속 제공한다.

## 실행

프로젝트 폴더의 `.env`에 서버용 `GEMINI_API_KEY`를 설정한 뒤:

```powershell
$env:PORT = "3001"
npm run start:gemini
```

기존 DB를 계속 사용하려면 `$env:DB_PATH`에 그 SQLite 파일의 절대 경로를 지정한다. 환경 파일·DB·답변 캐시에는 사용자 정보나 키가 들어갈 수 있으므로 커밋하지 않는다. `start:gemini`는 추천 질문의 자동 예열을 기본 off로 두며 필요하면 `WARM_ANSWERS`로 켤 수 있다. Ollama/vLLM 비교 실행 경로는 남겨 두었다.

이 시연은 **Gemini 기반 RAG·Agent 교육 서비스**다. 현재 운영 모델을 자체 학습/Private LLM이라고 표현하지 않는다. 로컬 공개 모델 서빙 실험은 이전 Ollama 문서와 평가 결과로 구분한다.

## 검증

- 빌드와 자동 테스트 **367개 통과**.
- 브라우저에서 1366×768, 1280×720, 390×844 화면 확인.
- 공정 화면은 채팅 DOM·`/api/chat` 요청이 없고, 선택한 공정·설비를 마이페이지에 전달한다.
- 실제 Gemini 응답: 고로에서 코크스의 탄소/열 공급과 일산화탄소의 환원 역할을 설명하는 답변을 수신했다.
- 미통과/통과 결과는 UI fixture로 표정과 전환을 검증했다. 실제 시험 점수를 바꾸거나 모델의 채점 정확도를 재측정한 검사가 아니다.
- 동작 축소, 기존 로딩 카드 닫힘, 현재 단계의 `aria-current` 개선도 보존했다.

선택적 브라우저 검사(별도 QA 서버/DB 사용):

```powershell
npm install --prefix data/browser-tools playwright --no-package-lock --ignore-scripts
$env:DEMO_QA_URL = "http://127.0.0.1:3012"
node scripts/check-demo-layout.mjs
```

Chromium 경로는 검사 스크립트의 로컬 설치 버전에 맞춘다. 스크립트는 QA 계정을 만들고 실제 Gemini를 호출한다.

스크린샷: [미통과](screenshots/demo-fixes/exam-retry.png), [통과](screenshots/demo-fixes/exam-pass.png), [공정 화면](screenshots/demo-fixes/process-1280.png), [마이페이지](screenshots/demo-fixes/mypage-1366.png).
