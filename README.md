# 제선 공정 질문형 교육 MVP

포스코 공개 공식 자료에 근거해 신입사원의 제선 기초 질문에 한국어로 답하는 단일 화면입니다. 고로와 FINEX 경로를 구분하며, 출처 링크를 함께 표시합니다.

실행과 자료 범위는 [README-ko.txt](README-ko.txt)를 참고하세요.

Ollama에 기존 제선 근거와 튜터를 연결하는 방법: [로컬 Ollama 실행 안내](docs/ollama-local.md). 자료를 붙인 터미널 질문은 `npm.cmd run chat:ollama`, 웹 앱은 `npm.cmd run start:ollama`로 실행합니다. 실제 모델로 제선 체크포인트 전체 흐름을 검증하려면 `npm.cmd run test:ollama-checkpoint`, 채점 평가 세트를 실행하려면 `npm.cmd run eval:ollama -- --set smoke --limit 7`을 사용합니다.

```powershell
npm.cmd ci
# .env 파일의 GEMINI_API_KEY= 뒤에 본인의 키 입력
npm.cmd start
```

브라우저에서 <http://localhost:3000>을 엽니다. `.env`는 서버 시작 시 읽으며 Git에서 제외됩니다. Gemini API 키가 없으면 미연결 상태를 표시하고 답변을 생성하지 않습니다.

공개 공식 자료 목록: [backend/data/ironmaking-sources.json](backend/data/ironmaking-sources.json). 기존 3D 데모는 이 화면과 연결되지 않습니다.
