# GKE Private LLM 배포

이 디렉터리는 실행 전 값을 채워야 하는 배포 템플릿이다. 모델·GPU·이미지·도메인·인증 값은 이 저장소에서 임의로 확정하지 않는다.

1. `secrets.example.yaml`의 값을 Secret Manager 또는 클러스터 Secret으로 안전하게 만든다. 파일 자체를 커밋하지 않는다.
2. `configmap.yaml`의 `VLLM_MODEL_ID`와 `LLM_MODEL`을 같은 서빙 모델에 맞춘다.
3. `vllm.yaml`의 이미지를 부하 테스트에 사용한 고정 버전으로 바꾼다.
4. `app.yaml`의 애플리케이션 이미지를 채운다.
5. GPU 노드풀과 NVIDIA device plugin을 준비한 뒤 `kubectl apply -f deploy/k8s/`를 실행한다.
6. `kubectl -n st-rookie rollout status deployment/vllm` 및 `deployment/st-rookie`를 확인하고 `scripts/verify-private-cutover.mjs`를 `LLM_PROVIDER=vllm PRIVATE_LLM_ONLY=1` 환경에서 실행한다.

앱 이미지는 루트의 `deploy/app/Dockerfile`로 빌드한다. 예: `docker build -f deploy/app/Dockerfile -t REPLACE_WITH_REGISTRY/st-rookie:TAG .`.

vLLM과 앱 Service는 모두 ClusterIP이고 NetworkPolicy는 vLLM Ingress를 앱 Pod로 제한한다. 외부 공개 Ingress, TLS, 조직별 인증은 배포 환경의 표준에 맞춰 추가한다.
