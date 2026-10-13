# Fine-tuning 데이터 준비

`examples.jsonl`은 검수된 예시만 넣는 입력 파일이다. 학습자의 원문 답변은 튜터의 모범 출력으로 직접 넣지 않는다.

```powershell
npm run finetune:prepare
```

출력은 Git에서 제외되는 `data/finetune/`에 생성된다. `group` 단위로 train/validation/test를 나누므로 같은 개념의 유사 예시가 서로 다른 세트에 섞이지 않는다. 현재 예시는 파이프라인 검증용 소량 synthetic 데이터이며, 이것만으로 Fine-tuning을 수행하거나 품질 개선을 주장할 수 없다.
