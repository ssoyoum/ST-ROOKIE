// Explicit local development mode. Keep .env Gemini credentials for comparison.
process.env.LLM_PROVIDER = "ollama";
process.env.LLM_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
process.env.LLM_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
process.env.PRIVATE_LLM_ONLY = "1";
console.log(`Ollama 학습 튜터: ${process.env.LLM_MODEL} (로컬 자료 검색 + 기존 튜터 프롬프트)`);
const { OllamaClient } = await import("../.build/llm/src/ollama.js");
console.log("Ollama 모델 미리 로드 중…");
await new OllamaClient().warmUp();
console.log("모델 로드 완료. 웹 서버를 시작합니다.");
await import("../.build/backend/src/ironmaking-server.js");
