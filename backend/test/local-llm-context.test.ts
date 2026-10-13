import assert from "node:assert/strict";
import test from "node:test";
import { compactLearningInput } from "../../llm/src/learning-context.js";
import { GeminiLearningAgent, type LearningInput } from "../../llm/src/learning-agent.js";
import { Retriever, loadSectionChunks } from "../../llm/src/retrieval.js";
import { getPublicSources } from "../../llm/src/ironmaking-sources.js";

test("local context preserves whole evidence, the current question and the latest referents", () => {
  const input: LearningInput = { section: "ironmaking", question: "그럼 전로에서 하는 일은 뭐예요?", screen: { process_id: "ironmaking" },
    concepts: [], openMisconceptions: [],
    chunks: Array.from({ length: 5 }, (_, i) => ({ id: `chunk-${i}`, section: "ironmaking", title: "근거", text: `환원 역할 ${i}`, source_ids: ["src"], tags: [], score: 1 })),
    history: Array.from({ length: 6 }, (_, i) => ({ question: `질문 ${i}`, answer: "앞선 설명".repeat(300) })),
    scene: { processes: [
      { id: "ironmaking", name: "제선", equipment: [{ id: "blast_furnace", name: "고로" }] },
      { id: "steelmaking", name: "제강", equipment: [{ id: "bof", name: "전로 (BOF)" }, { id: "ladle", name: "래들" }] },
    ] },
  };
  const compact = compactLearningInput(input);
  assert.equal(compact.question, input.question);
  assert.equal(compact.chunks.length, 3);
  assert.equal(compact.chunks[0].text, input.chunks[0].text);
  assert.deepEqual(compact.history.map((h) => h.question), ["질문 4", "질문 5"]);
  assert.match(compact.history[0].answer, /일부 생략/);
  assert.equal(input.history.length, 6);
  assert.deepEqual(compact.scene?.processes[1].equipment.map((e) => e.id), ["bof"]);
  const oversized = compactLearningInput({ ...input, chunks: [{ ...input.chunks[0], text: "근거".repeat(3000) }] });
  assert.equal(oversized.chunks.length, 0, "긴 근거는 중간을 잘라 잘못 인용하지 않는다");
});

test("compact tutor constrains citations to the evidence actually sent", async () => {
  const chunks = new Retriever().retrieve("ironmaking", "코크스의 환원 역할은?");
  const input: LearningInput = { section: "ironmaking", question: "코크스의 환원 역할은?", screen: {}, chunks, history: [], concepts: [], openMisconceptions: [] };
  const agent = new GeminiLearningAgent({ generate: async (request) => {
    assert.equal(request.maxOutputTokens, 768);
    assert.match(request.system, /follow_up은 기본 null/);
    const allowed = compactLearningInput(input).chunks.map((c) => c.id);
    assert.equal(allowed.length, 3);
    const discarded = chunks.find((c) => !allowed.includes(c.id));
    assert.ok(discarded);
    return JSON.stringify({ answer: "일산화탄소가 환원에 관여해요.", status: "grounded", source_ids: [allowed[0], discarded.id],
      follow_up: null, detected_misconception: null, scene_actions: [] });
  } }, [], "compact");
  const reply = await agent.reply(input);
  assert.equal(reply.source_ids.length, 1);
});

test("idf ranking prefers discriminating terms over frequent generic titles", () => {
  const chunks = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `generic-${i}`, section: "ironmaking" as const, title: "공정", text: "공정", source_ids: [], tags: [] })),
    { id: "reduction", section: "ironmaking" as const, title: "", text: "환원", source_ids: [], tags: [] },
  ];
  assert.equal(new Retriever({ chunksFor: () => chunks, ranking: "overlap" }).retrieve("ironmaking", "환원 공정")[0].id, "generic-0");
  assert.equal(new Retriever({ chunksFor: () => chunks }).retrieve("ironmaking", "환원 공정")[0].id, "reduction");
});

test("curated evidence has resolvable public citations and retains existing public notes", () => {
  const chunks = loadSectionChunks("ironmaking");
  assert.ok(chunks.some((c) => c.id === "coke_reduction"));
  assert.ok(chunks.some((c) => c.id === "posco-newsroom-fe-2019#3"));
  const curated = chunks.filter((c) => !c.id.includes("#"));
  for (const c of curated) assert.equal(getPublicSources(c.source_ids).length, c.source_ids.length, c.id);
  assert.match(chunks.find((c) => c.id === "coke_reduction")!.text, /일산화탄소/);
  assert.equal(new Retriever({ maxResults: 3 }).retrieve("ironmaking", "고로").length, 3);
});
