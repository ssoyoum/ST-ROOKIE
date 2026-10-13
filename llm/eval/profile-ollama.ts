// Compare real RAG requests. Record native timing/token counters without logging credentials.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { loadSceneCatalog } from "../../backend/src/learning/scene-catalog.js";
import { GeminiLearningAgent, type LearningInput } from "../src/learning-agent.js";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, OllamaClient } from "../src/ollama.js";
import { Retriever } from "../src/retrieval.js";
import { compactLearningInput } from "../src/learning-context.js";
import { option, RESULTS_DIR } from "./run-log.js";

export async function profileOllama() {
  const label = option("label", "run");
  const question = option("question", "한국어로 답해줘. 고로에서 코크스는 어떤 역할을 하나요?");
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const counters: Record<string, unknown>[] = [];
  const client = new OllamaClient({ model, baseUrl, fetch: (async (url, init) => {
    const request = init?.body ? JSON.parse(String(init.body)) : {};
    const response = await fetch(url, init);
    const body = await response.clone().json() as Record<string, unknown>;
    if (request.messages) counters.push({
      input_chars: request.messages.reduce((n: number, m: { content: string }) => n + m.content.length, 0),
      output_chars: (body.message as { content?: string } | undefined)?.content?.length ?? 0,
      num_ctx: request.options?.num_ctx,
      load_ms: Number(body.load_duration ?? 0) / 1e6,
      prompt_tokens: body.prompt_eval_count,
      prompt_ms: Number(body.prompt_eval_duration ?? 0) / 1e6,
      output_tokens: body.eval_count,
      generation_ms: Number(body.eval_duration ?? 0) / 1e6,
    });
    return response;
  }) as typeof fetch });
  const rubric = loadFinalRubrics().find((r) => r.section === "ironmaking")!;
  const input: LearningInput = {
    section: rubric.section, question, screen: { process_id: rubric.section, equipment_id: "blast_furnace" },
    chunks: new Retriever({ glossaryFor: () => rubric.glossary ?? [] }).retrieve(rubric.section, question, { equipment_id: "blast_furnace" }),
    history: [], openMisconceptions: [], concepts: rubric.concepts, glossary: rubric.glossary, scene: await loadSceneCatalog(),
  };
  const profile = option("profile", "compact");
  if (profile !== "full" && profile !== "compact") throw new Error("--profile은 full 또는 compact입니다.");
  const prepared = profile === "compact" ? compactLearningInput(input) : input;
  const agent = new GeminiLearningAgent(client, undefined, profile);
  console.log(`${label}: ${question} · 응답 생성 중…`);
  const started = Date.now();
  const reply = await agent.reply(input);
  const report = { label, provider: "Ollama", model, question, elapsed_ms: Date.now() - started,
    profile, retrieved_chunks: input.chunks.map((c) => c.id), sent_chunks: prepared.chunks.map((c) => c.id), counters, reply, at: new Date().toISOString() };
  const path = option("records", join(RESULTS_DIR, `ollama-profile-${label}-${Date.now()}.json`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
  console.log(`기록: ${path}`);
}

await profileOllama().catch((error: unknown) => { console.error((error as Error).message); process.exitCode = 1; });
