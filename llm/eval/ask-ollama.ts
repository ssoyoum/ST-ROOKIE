import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { loadSceneCatalog } from "../../backend/src/learning/scene-catalog.js";
import { isSafetyQuestion, SAFETY_ANSWER } from "../../backend/src/learning/safety.js";
import { GeminiLearningAgent } from "../src/learning-agent.js";
import { OllamaClient, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "../src/ollama.js";
import { Retriever } from "../src/retrieval.js";

async function main() {
  const question = process.argv.slice(2).join(" ").trim() || "한국어로 답해줘. 고로에서 코크스는 어떤 역할을 하나요?";
  if (isSafetyQuestion(question)) { console.log(SAFETY_ANSWER); return; }
  const client = new OllamaClient({
    baseUrl: process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
    model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
  });
  const connection = await client.checkConnection();
  if (!connection.connected) throw new Error(connection.reason === "model_missing" ? "Ollama에 사용할 모델이 없습니다. 모델을 먼저 다운로드하세요." : "Ollama 서버에 연결하지 못했습니다. Ollama 앱을 실행하세요.");
  const rubric = loadFinalRubrics().find((r) => r.section === "ironmaking")!;
  const retriever = new Retriever({ glossaryFor: () => rubric.glossary ?? [] });
  const chunks = retriever.retrieve("ironmaking", question, { process_id: "ironmaking" });
  console.log(`질문: ${question}\n검색 근거: ${chunks.map((c) => c.id).join(", ") || "없음"}\n답변 생성 중…`);
  const started = Date.now();
  const reply = await new GeminiLearningAgent(client, undefined, "compact").reply({
    section: "ironmaking", question, screen: { process_id: "ironmaking", equipment_id: null }, chunks,
    history: [], openMisconceptions: [], concepts: rubric.concepts.map(({ concept_id, name }) => ({ concept_id, name })),
    glossary: rubric.glossary, scene: await loadSceneCatalog(),
  });
  console.log(JSON.stringify({ provider: "Ollama", model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL, elapsed_ms: Date.now() - started, ...reply }, null, 2));
}

await main().catch((error: unknown) => { console.error((error as Error).message); process.exitCode = 1; });
