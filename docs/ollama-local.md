# Ollama에 제선 자료와 튜터 연결하기

`ollama run qwen2.5:3b`는 모델과의 일반 채팅이다. 프로젝트 자료는 전달하지 않는다. 아래 프로젝트 명령은 기존 Retriever가 찾은 제선 공개 자료 메모, 용어집, 튜터 프롬프트, 응답 스키마를 Ollama에 전달한다.

## 준비

Ollama 앱을 실행하고 모델을 미리 다운로드한다. PowerShell에서 명령을 찾지 못하면 전체 경로를 사용한다.

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" pull qwen2.5:3b
```

## 자료를 붙여 답변 확인

프로젝트 폴더의 PowerShell(`PS C:\...>`)에서 실행한다. Ollama 채팅 입력창(`>>>`)에 입력하지 않는다.

```powershell
npm.cmd run chat:ollama
```

기본 질문은 “한국어로 답해줘. 고로에서 코크스는 어떤 역할을 하나요?”다. 다른 질문은 인자로 전달한다.

```powershell
npm.cmd run chat:ollama -- "코크스는 불순물을 없애는 역할인가요?"
```

검색 근거 ID, 답변, 모델의 근거 판정, 인용 ID, 화면 조작, 소요 시간을 출력한다. 인용 ID는 서버 검증을 거치지만 답변 내용의 사실성을 자동으로 입증하지는 않는다. 내용과 근거는 사람이 비교해야 한다.

## 웹 앱에서 질문

기존 `npm start` 서버가 실행 중이면 해당 터미널에서 `Ctrl+C`로 종료한 뒤 실행한다.

```powershell
npm.cmd run start:ollama
```

브라우저에서 `http://localhost:3000`을 열어 학습 채팅에 질문한다. 기존 화면·학습 기록·체크포인트·관리자 요약을 사용한다. `/api/status`는 Ollama 서버와 다운로드된 모델 목록을 실제로 조회한다. 첫 응답의 성공이나 답변 품질을 보장하는 상태 값은 아니다.

`start:ollama`는 이 프로세스에서만 `LLM_PROVIDER=ollama`, `PRIVATE_LLM_ONLY=1`을 설정한다. Gemini로 자동 fallback하지 않는다. `.env`의 Gemini 키는 비교용으로 그대로 보존한다. 일반 `npm start`는 기존 provider 설정을 따른다.

3000번을 다른 서버가 사용 중이면 별도 포트를 지정한다. 이번 검증에서 연 Ollama 서비스 주소는 `http://localhost:3001`이다.

```powershell
$env:PORT = "3001"
npm.cmd run start:ollama
```

`http://localhost:3001/api/status`의 `provider: "Ollama"`, `connected: true`를 확인한다. 웹 화면의 **제선 → 튜터 → 이해도 확인**에서 체크포인트를 시작한다. 서버를 다시 시작하면 임시 JWT 키를 사용한 기존 로그인은 다시 해야 할 수 있다.

3D 화면 없이 체크포인트만 직접 시험하려면 `http://localhost:3001/checkpoint-test.html?user=ollama-demo`를 연다. 이 페이지는 같은 실제 체크포인트 API를 사용하며, 제출한 결과는 서비스 DB에 해당 테스트 사용자 이름으로 저장된다. 아래 자동 검증 명령은 서비스 DB 대신 별도 메모리 DB를 사용한다.

## 실제 Ollama 체크포인트 전체 흐름 검증

```powershell
npm.cmd run test:ollama-checkpoint
```

`llm/eval/run-ollama.ts --mode checkpoint`는 실제 Ollama와 서비스의 체크포인트 엔진·HTTP 라우터·최종 루브릭을 사용한다. 가짜 모델 응답은 넣지 않는다. 임시 포트와 `:memory:` DB를 만들어 실행하고 종료 때 닫으므로 서비스 학습 기록과 호출 한도를 변경하지 않는다.

제선 세 개념 전체를 진행한다. 첫 개념에 평가 세트의 명백한 오답을 넣어 `wrong` 판정·부가 설명·다른 재확인 질문을 확인한 뒤, 루브릭의 핵심 요소로 만든 합성 정답을 제출한다. 나머지 개념을 모두 마친 후 `completed`, 개념별 만점, 이해도 100%, 해금, DB 저장, 대화 복원, 진도 조회를 확인한다. 판정·형식·HTTP·저장 검증이 실패하면 종료 코드 1과 단계별 기록을 남긴다.

이 검증은 API 흐름 확인이다. 실제 사람의 다양한 답변에 대한 채점 정확도나 브라우저 화면을 직접 조작한 검증을 대신하지 않는다. 결과 JSONL과 요약 JSON은 `llm/eval/results/`에 저장한다(Git 제외).

## Ollama 채점 정확도 평가

```powershell
# initial/recheck 판정별 대표 케이스부터 7개 표본 평가
npm.cmd run eval:ollama -- --set smoke --limit 7

# 같은 파일과 설정으로 이미 끝난 케이스는 재사용
npm.cmd run eval:ollama -- --set smoke --limit 7 --resume

# smoke 전체 평가: 연결·기본 회귀 확인
npm.cmd run eval:ollama -- --set smoke --resume

# hard 전체 평가: 더 어려운 표현·혼합 오개념 등
npm.cmd run eval:ollama -- --set hard
```

기존 smoke/hard 평가 세트를 같은 최종 루브릭과 평가자 프롬프트로 채점한다. Gemini 키는 필요하지 않다. 기본 모델은 `qwen2.5:3b`이며 `OLLAMA_MODEL`, `OLLAMA_BASE_URL`로 바꿀 수 있다. `--limit 0` 또는 생략은 전체다. `--records`로 결과 파일을 지정하고 `--timeout-ms`로 호출 제한 시간을 바꾼다.

기대 판정 일치율, 형식 오류, 연결 오류, 케이스별 시간, p50/p95를 기록한다. 형식 오류는 불일치로 포함하고 연결 오류는 별도 표시한다. 연결 오류가 3건 연속이면 중단하며 자동 Gemini fallback은 없다. 불일치·형식 오류·연결 오류·미완료는 종료 코드 1이다. 기존 결과 파일을 덮어쓰지 않으므로 이어서 실행할 때 `--resume`을 사용한다. 형식 오류 케이스를 다시 호출하려면 `--records`로 새 파일을 지정한다.

한 번에 하나씩 실행한다. CPU에서 웹 질문과 평가를 동시에 실행하면 요청이 기다리고 측정 시간이 늘어날 수 있다. `--limit` 결과는 선택된 표본의 결과이며 전체 세트 정확도로 표현하지 않는다. smoke의 높은 일치율도 사람 답변의 품질을 보장하지 않는다.

## 다른 모델 또는 서버

```powershell
$env:OLLAMA_MODEL = "다운로드한모델이름"
$env:OLLAMA_BASE_URL = "http://localhost:11434"
npm.cmd run start:ollama
```

기본 모델은 `qwen2.5:3b`, 서버는 `http://localhost:11434`다. 응답 요청에는 문맥 길이 8192, 토큰 제한, 기존 요청의 temperature를 적용한다. 로컬 생성은 기본 180초 timeout이며 CPU와 모델에 따라 느릴 수 있다.

이 연결은 Fine-tuning이 아니다. 검색한 근거를 요청마다 전달하는 RAG 연결이다. 고로를 고등어로 해석하는 오류 등은 자료를 붙인 실제 결과를 보고 모델 교체 여부를 판단한다.

## 실제 확인한 결과 (2026-10-13)

체크포인트 자동 검증은 실제 모델 호출 9회로 제선 세 개념 전체를 완료했다. 명백한 오답의 `wrong` 판정, 부가 설명과 재확인, 재확인 정답, 나머지 두 개념 정답, 최종 `completed`, 이해도 100%, 해금, 결과·대화 복원·진도 조회가 모두 통과했다. 전체 약 369.5초(6분 10초), 개별 모델 호출 약 9.6~158.9초였다. 이것은 루브릭의 핵심 요소로 작성한 합성 정답을 사용한 1회 API 검증이며 실제 사람 답변 전체의 채점 정확도 검증이 아니다.

별도 smoke 평가 7개 표본은 4/7 일치(57.1%)였다. 부분 정답 2건을 오답으로 처리했고, 힌트 요청 1건은 판정 필드 일관성 검증에 실패했다. 연결 오류는 없었다. 표본 결과는 전체 smoke/hard 정확도가 아니다. 자세한 근거와 남은 작업은 [실제 검증 결과](ollama-verification-2026-10-13.md)에 기록했다.

Qwen2.5 3B Q4_K_M에 기존 자료 5개와 튜터 프롬프트를 전달했다. 기본 코크스 질문은 1회 실행에서 약 83초 후 다음 답변을 반환했다.

> 고로에서 코크스는 산화하며 철광석의 산소를 떼어내는 환원 과정에 사용됩니다. 이 과정에서 일산화탄소가 생성되고, 이를 통해 철광석이 용선으로 변환됩니다.

모델은 `grounded`를 반환하고 `posco-brochure-2015#3`을 인용했다. 단일 질문에서 이전의 고등어 답변은 재현되지 않았다. 이 결과는 답변 전체 품질을 보장하지 않으며 느린 첫 응답을 시연 성능으로 합격 처리하지 않는다.

웹 앱도 임시 포트 3001·메모리 DB로 실행해 검증했다. `/api/status`가 실제 모델을 확인했고, `/api/chat`의 “코크스는 불순물을 없애는 역할인가요?”에 “탄소질 연료이지만, 불순물을 없애는 역할은 아니에요”라는 답과 출처 링크를 반환했다. 후속 질문에는 불순물 제거를 고로와 연결하는 표현이 남아 있어, 추가 질문 품질은 개선 대상이다. 테스트 서버와 메모리 DB는 검증 후 종료한다.

## 기술 근거

- [Ollama Chat API](https://docs.ollama.com/api/chat): 로컬 `/api/chat`의 messages·format·options 사용.
- [Ollama 구조화 출력](https://docs.ollama.com/capabilities/structured-outputs): format에 JSON Schema를 전달하고 출력은 서버에서 다시 검증.
