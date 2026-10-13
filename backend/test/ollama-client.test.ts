import assert from "node:assert/strict";
import test from "node:test";
import { GeminiCallError } from "../../llm/src/gemini.js";
import { toJsonSchema } from "../../llm/src/json-schema.js";
import { OllamaClient } from "../../llm/src/ollama.js";
import { createLlmClient } from "../../llm/src/provider.js";
import { GeminiLearningAgent, type LearningInput } from "../../llm/src/learning-agent.js";

test("Ollama RAG sends sources and the existing tutor prompt, then validates citations", async () => {
  let calls = 0;
  const input: LearningInput = {
    section: "ironmaking", question: "코크스는 어떤 역할인가요?", screen: { process_id: "ironmaking" },
    chunks: [{ id: "coke#1", section: "ironmaking", title: "코크스의 역할", text: "코크스는 연료이며 환원에 관여한다.", source_ids: ["coke"], tags: [], score: 1 }],
    history: [], openMisconceptions: [], concepts: [],
  };
  const client = new OllamaClient({ model: "qwen2.5:3b", baseUrl: "http://ollama.test", beforeCall: () => { calls++; }, fetch: (async (url, init) => {
    assert.equal(String(url), "http://ollama.test/api/chat");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, false);
    assert.equal(body.model, "qwen2.5:3b");
    assert.match(body.messages[0].content, /근거 조각에 직접 근거한 내용으로만/);
    assert.match(body.messages[1].content, /\[coke#1\]/);
    assert.match(body.messages[1].content, /코크스는 연료이며 환원에 관여한다/);
    assert.deepEqual(body.format.properties.follow_up.type, ["string", "null"]);
    assert.deepEqual(body.format.properties.source_ids.items.enum, ["coke#1"]);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({
      answer: "코크스는 고로에서 연료로 쓰이며 환원에 관여해요.", status: "grounded",
      source_ids: ["coke#1", "invented"], follow_up: null, detected_misconception: null, scene_actions: [],
    }) } }));
  }) as typeof fetch });
  const reply = await new GeminiLearningAgent(client).reply(input);
  assert.equal(calls, 1);
  assert.equal(reply.status, "grounded");
  assert.deepEqual(reply.source_ids, ["coke#1"]);
  assert.match(reply.answer, /환원/);
});

test("schema conversion supports nullable enums and nested objects without mutating the input", () => {
  const schema = { type: "OBJECT", properties: { nullable: { type: "STRING", nullable: true, enum: ["a"] }, nested: { type: "OBJECT", nullable: true } }, propertyOrdering: ["nullable", "nested"] };
  assert.deepEqual(toJsonSchema(schema), { type: "object", properties: { nullable: { type: ["string", "null"], enum: ["a", null] }, nested: { type: ["object", "null"] } } });
  assert.equal(schema.properties.nullable.type, "STRING");
});

test("Ollama reports a downloaded model, a missing model, and an unreachable server accurately", async () => {
  const ready = new OllamaClient({ model: "test", fetch: (async () => Response.json({ models: [{ name: "test:latest" }] })) as typeof fetch });
  assert.deepEqual(await ready.checkConnection(), { connected: true, reason: "ready" });
  const missing = new OllamaClient({ model: "test", fetch: (async () => Response.json({ models: [] })) as typeof fetch });
  assert.deepEqual(await missing.checkConnection(), { connected: false, reason: "model_missing" });
  const down = new OllamaClient({ fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
  assert.deepEqual(await down.checkConnection(), { connected: false, reason: "unreachable" });
});

test("Ollama errors do not fall back to Gemini and preserve the quota check", async () => {
  const request = { system: "", prompt: "", temperature: 0, maxOutputTokens: 1 };
  let calls = 0;
  const limited = new OllamaClient({ beforeCall: () => { throw new Error("quota"); }, fetch: (async () => { calls++; return Response.json({}); }) as typeof fetch });
  await assert.rejects(limited.generate(request), /quota/);
  assert.equal(calls, 0);
  const error = new OllamaClient({ fetch: (async () => new Response("", { status: 503 })) as typeof fetch });
  await assert.rejects(error.generate(request), (e: unknown) => e instanceof GeminiCallError && e.httpStatus === 503);
  const empty = new OllamaClient({ fetch: (async () => Response.json({ done: true })) as typeof fetch });
  await assert.rejects(empty.generate(request), /Ollama 응답이 비어/);
});

test("private mode selects Ollama explicitly and blocks Gemini", () => {
  const prior = { provider: process.env.LLM_PROVIDER, privateOnly: process.env.PRIVATE_LLM_ONLY };
  try {
    process.env.PRIVATE_LLM_ONLY = "1";
    process.env.LLM_PROVIDER = "ollama";
    assert.ok(createLlmClient() instanceof OllamaClient);
    process.env.LLM_PROVIDER = "gemini";
    assert.throws(() => createLlmClient(), /Gemini를 사용할 수 없습니다/);
  } finally {
    if (prior.provider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = prior.provider;
    if (prior.privateOnly === undefined) delete process.env.PRIVATE_LLM_ONLY; else process.env.PRIVATE_LLM_ONLY = prior.privateOnly;
  }
});

test("Ollama preload and inference use the same context and keep-alive without charging preload quota", async () => {
  let charged = 0;
  let requests = 0;
  const client = new OllamaClient({ contextLength: 4096, keepAlive: "20m", beforeCall: () => { charged++; }, fetch: (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.options.num_ctx, 4096);
    assert.equal(body.keep_alive, "20m");
    requests++;
    return requests === 1 ? Response.json({ done: true }) : Response.json({ message: { content: "준비됐어요." } });
  }) as typeof fetch });
  await client.warmUp();
  assert.equal(charged, 0);
  assert.equal(await client.generate({ system: "", prompt: "", temperature: 0, maxOutputTokens: 10 }), "준비됐어요.");
  assert.equal(charged, 1);
});

test("Ollama preload rejects HTTP and incomplete responses", async () => {
  await assert.rejects(new OllamaClient({ fetch: (async () => new Response("", { status: 404 })) as typeof fetch }).warmUp(), /미리 로드 실패/);
  await assert.rejects(new OllamaClient({ fetch: (async () => Response.json({ done: false })) as typeof fetch }).warmUp(), /응답이 올바르지/);
});
