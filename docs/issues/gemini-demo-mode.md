## 문제

노트북의 CPU 기반 Ollama 추론 속도가 시연에 적합하지 않아 운영 시연 모델을 Gemini로 전환한다. 이미 켜진 서버만 바꾸면 다음 실행에서 Ollama로 돌아갈 수 있다.

## 근거

`scripts/start-ollama.mjs`는 provider를 Ollama로 강제하고 모델을 미리 로드한다. 공통 provider factory는 기본 Gemini를 지원하지만 `.env`와 실행 환경의 `PRIVATE_LLM_ONLY=1`이 Gemini 시작을 막을 수 있다. 현재 3001 `/api/status`는 Gemini를 반환한다.

## 변경 범위

- Gemini를 명시적으로 선택하는 실행 명령과 환경 예제를 제공한다.
- 학습·평가·관리자 요약은 같은 provider factory를 사용한다.
- 기존 RAG·루브릭·교육 기록과 Gemini 서버 키를 보존한다.
- Ollama/vLLM 비교 경로는 선택적으로 남기며 운영 시연은 Gemini로 실행한다.

## 완료 기준

- 명령 하나로 Gemini 모드가 재현된다.
- 3001 서버의 provider 상태와 실제 학습 응답을 확인한다.
- 프론트에는 API 키가 없고 기존 사용자 기록이 유지된다.

관련: 공정 화면과 마이페이지 개편.
