// Live Ollama checks. Never uses Gemini or writes to the service database.
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../../backend/src/app.js";
import { CheckpointEngine } from "../../backend/src/checkpoint/engine.js";
import { CheckpointRepository, type ConceptResultRow } from "../../backend/src/checkpoint/repository.js";
import type { CheckpointView, SectionProgressView } from "../../backend/src/checkpoint/types.js";
import { openDatabase } from "../../backend/src/db/database.js";
import { loadFinalRubrics, type RubricConcept } from "../../backend/src/rubrics.js";
import { LlmUsage } from "../../backend/src/usage.js";
import { evaluatorResponseSchema, evaluatorSystemPrompt, evaluatorUserPrompt, GeminiEvaluator } from "../src/evaluator.js";
import type { GenerateRequest, LlmClient } from "../src/llm-client.js";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, OllamaClient } from "../src/ollama.js";
import { toJsonSchema } from "../src/json-schema.js";
import { GeminiTutor } from "../src/tutor.js";
import { EVAL_SETS, loadEvalSet, type EvalSetName } from "./eval-set.js";
import { fingerprint, flag, isInfraError, option, openRecordFile, RESULTS_DIR, type RunRecord } from "./run-log.js";

const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
const mode = option("mode", "evaluator");
const timeoutMs = Number(option("timeout-ms", "180000"));

interface CallTiming { elapsed_ms: number; ok: boolean; error?: string }

/** Keep real calls visible during CPU inference. No fake verdicts or response substitution. */
class MeasuredClient implements LlmClient {
  readonly calls: CallTiming[] = [];
  constructor(private readonly client: OllamaClient) {}
  async generate(request: GenerateRequest): Promise<string> {
    const started = Date.now();
    console.log(`  Ollama 호출 ${this.calls.length + 1} 생성 중…`);
    try {
      const response = await this.client.generate(request);
      this.calls.push({ elapsed_ms: Date.now() - started, ok: true });
      console.log(`  응답 ${(this.calls.at(-1)!.elapsed_ms / 1000).toFixed(1)}초`);
      return response;
    } catch (error) {
      this.calls.push({ elapsed_ms: Date.now() - started, ok: false, error: (error as Error).message });
      throw error;
    }
  }
}

interface EvalRecord extends RunRecord {
  provider: "Ollama";
  model: string;
  base_url: string;
  concept_id: string;
  phase: string;
  expected: string;
  got: string;
  evidence: string;
  misconception: string | null;
  explain_from: number | null;
  attempts: number;
  format_problems: string[];
  /** 형식 보정·경계 재확인으로 바꾼 내용. */
  adjustments?: string[];
  elapsed_ms: number;
  calls: CallTiming[];
  error?: string;
  at: string;
}

async function runEvaluator(client: MeasuredClient) {
  const set = option("set", "smoke") as EvalSetName;
  assert.ok(EVAL_SETS.includes(set), "--set은 smoke 또는 hard입니다.");
  const limit = Number(option("limit", "0"));
  assert.ok(Number.isInteger(limit) && limit >= 0, "--limit은 0(전체) 또는 양의 정수입니다.");
  const entries = loadFinalRubrics().flatMap((rubric) => loadEvalSet(set, rubric.section).map((c) => ({ rubric, c })));
  // With a limit, sample each verdict/phase before taking duplicates. This is a sample, not a full-set result.
  const seen = new Set<string>();
  const first = entries.filter(({ c }) => {
    const key = `${c.phase}:${c.expected_verdict}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const selected = limit ? [...first, ...entries.filter((e) => !first.includes(e))].slice(0, limit) : entries;
  assert.ok(selected.length, "평가 케이스가 없습니다.");
  const records = openRecordFile<EvalRecord>(option("records", join(RESULTS_DIR, `ollama-evaluator-${set}.jsonl`)), flag("resume"));
  // 경계 재확인(verifyBoundary)·형식 보정(repairFormat)은 로컬 모델 서버와 같이 켠다. --no-verify면 둘 다 끄고 잰다(전후 비교).
  const verify = !flag("no-verify");
  const evaluator = new GeminiEvaluator(client, { verifyBoundary: verify, repairFormat: verify });
  const results: EvalRecord[] = [];
  console.log(`${set}: ${selected.length}/${entries.length}개${limit ? " (표본)" : " (전체)"} · 기록 ${records.path}`);
  let infraStreak = 0;
  for (const { rubric, c } of selected) {
    const concept = rubric.concepts.find((k) => k.concept_id === c.concept_id);
    assert.ok(concept, `루브릭에 없는 개념: ${c.concept_id}`);
    const key = `${c.file}:${c.line}`;
    const fp = fingerprint("ollama", model, baseUrl, verify ? "evaluator-v2-verify" : "evaluator-v2", evaluatorSystemPrompt(rubric, concept, c.phase),
      evaluatorUserPrompt(c.question, c.answer), JSON.stringify(toJsonSchema(evaluatorResponseSchema(c.phase))));
    const prior = records.done(key, fp);
    if (prior) {
      results.push({ ...prior, expected: c.expected_verdict });
      console.log(`${key}: 이전 기록 사용 (${prior.got})`);
      continue;
    }
    console.log(`${key} · ${c.concept_id}/${c.phase} · 기대 ${c.expected_verdict}`);
    const started = Date.now();
    const callStart = client.calls.length;
    const common = { key, fingerprint: fp, provider: "Ollama" as const, model, base_url: baseUrl,
      concept_id: c.concept_id, phase: c.phase, expected: c.expected_verdict, at: new Date().toISOString() };
    let record: EvalRecord;
    try {
      const outcome = await evaluator.evaluateDetailed({ rubric, concept, question: c.question, answer: c.answer, phase: c.phase });
      record = { ...common, infra_error: false, got: outcome.evaluation?.verdict ?? "format_error",
        evidence: outcome.evaluation?.evidence ?? "", misconception: outcome.evaluation?.misconception ?? null,
        explain_from: outcome.evaluation?.explain_from ?? null, attempts: outcome.attempts,
        format_problems: outcome.formatProblems, adjustments: outcome.adjustments, elapsed_ms: Date.now() - started, calls: client.calls.slice(callStart) };
    } catch (error) {
      if (!isInfraError(error)) throw error;
      record = { ...common, infra_error: true, got: "infra_error", evidence: "", misconception: null,
        explain_from: null, attempts: client.calls.length - callStart, format_problems: [],
        elapsed_ms: Date.now() - started, calls: client.calls.slice(callStart), error: error.message };
    }
    records.append(record);
    results.push(record);
    console.log(`  판정 ${record.got}${record.got === record.expected ? " ✓" : " (기대와 불일치)"}`);
    infraStreak = record.infra_error ? infraStreak + 1 : 0;
    if (infraStreak >= 3) { console.error("연속 연결 오류 3건으로 중단합니다. --resume으로 이어서 실행하세요."); break; }
  }
  const evaluated = results.filter((r) => !r.infra_error);
  const correct = evaluated.filter((r) => r.got === r.expected).length;
  const timings = evaluated.map((r) => r.elapsed_ms).sort((a, b) => a - b);
  const summary = { mode, provider: "Ollama", model, set, sample: limit > 0, available: entries.length,
    selected: selected.length, completed: results.length, matches: correct, evaluated: evaluated.length,
    accuracy: evaluated.length ? correct / evaluated.length : null,
    format_errors: evaluated.filter((r) => r.got === "format_error").length,
    infra_errors: results.filter((r) => r.infra_error).length,
    p50_ms: timings.length ? timings[Math.ceil(timings.length * .5) - 1] : null,
    p95_ms: timings.length ? timings[Math.ceil(timings.length * .95) - 1] : null,
    records: records.path };
  console.log(JSON.stringify(summary, null, 2));
  for (const r of evaluated.filter((r) => r.got !== r.expected)) {
    console.log(`불일치 ${r.key}: ${r.expected} → ${r.got}\n${r.evidence || r.format_problems.join(" / ")}`);
  }
  writeFileSync(`${records.path}.summary.json`, JSON.stringify(summary, null, 2) + "\n");
  if (correct !== selected.length) process.exitCode = 1;
}

async function runCheckpoint(client: MeasuredClient) {
  assert.ok(!flag("resume"), "체크포인트는 매번 독립 메모리 DB에서 시작합니다. --resume은 평가자 모드에서만 사용하세요.");
  const records = option("records", join(RESULTS_DIR, `ollama-checkpoint-${Date.now()}.jsonl`));
  // Refuse an existing file instead of merging two independent attempts.
  mkdirSync(dirname(records), { recursive: true });
  writeFileSync(records, "", { flag: "wx" });
  const log = (event: unknown) => appendFileSync(records, JSON.stringify({ at: new Date().toISOString(), provider: "Ollama", model, ...event as object }) + "\n");
  const db = openDatabase(":memory:");
  const repo = new CheckpointRepository(db);
  const rubrics = loadFinalRubrics();
  const rubric = rubrics.find((r) => r.section === "ironmaking");
  assert.ok(rubric, "제선 최종 루브릭이 없습니다.");
  const wrong = loadEvalSet("smoke", rubric.section).find((c) => c.concept_id === rubric.concepts[0].concept_id && c.phase === "initial" && c.expected_verdict === "wrong");
  assert.ok(wrong, "첫 개념의 오답 평가 케이스가 없습니다.");
  const user = "ollama-checkpoint-eval";
  const usage = new LlmUsage(db, 1000);
  const engine = new CheckpointEngine({ repo, evaluator: new GeminiEvaluator(client), tutor: new GeminiTutor(client), rubrics });
  // Only this evaluation process changes access settings. The live web server is unaffected.
  process.env.TEST_PASSCODE = "";
  const app = createApp({ engine, usage });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const started = Date.now();
  async function request<T>(label: string, path: string, body?: unknown): Promise<T> {
    console.log(`[${label}] ${body === undefined ? "GET" : "POST"} ${path}`);
    const stepStart = Date.now();
    const response = await fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-User-Id": user },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs * 5),
    });
    const result = await response.json();
    log({ event: label, path, request: body ?? null, http_status: response.status, elapsed_ms: Date.now() - stepStart, response: result });
    assert.ok(response.ok, `${label}: HTTP ${response.status} ${JSON.stringify(result)}`);
    return result as T;
  }
  try {
    const status = await request<{ provider: string; connected: boolean; model: string }>("연결 확인", "/api/status");
    assert.equal(status.provider, "Ollama");
    assert.equal(status.model, model);
    assert.equal(status.connected, true);
    let view = await request<CheckpointView>("시작", "/api/checkpoints", { section: "ironmaking" });
    assert.equal(view.state, "awaiting_ready");
    const id = view.attempt_id;
    const messages = `/api/checkpoints/${id}/messages`;
    view = await request<CheckpointView>("준비 및 첫 질문", messages, { text: "준비됐어요." });
    assert.equal(view.state, "awaiting_answer");
    assert.equal(view.concept?.id, wrong.concept_id);
    view = await request<CheckpointView>("오답 채점 및 재확인 질문", messages, { text: wrong.answer });
    assert.equal(view.state, "awaiting_recheck", "명백한 오답이면 설명 후 재확인해야 합니다.");
    assert.ok(view.tutor.some((t) => t.type === "explanation" && t.text.trim()));
    assert.ok(view.tutor.some((t) => t.type === "recheck_question" && t.text.trim()));
    const initial = repo.listResults(id).find((r) => r.concept_id === wrong.concept_id);
    assert.equal(initial?.verdict, "wrong", "오답 채점 결과가 DB에 저장되어야 합니다.");
    assert.ok(initial?.recheck_question && initial.recheck_question !== initial.question);
    let answers = 0;
    while (view.state === "awaiting_answer" || view.state === "awaiting_recheck") {
      assert.ok(++answers <= rubric.concepts.length * 2, "예상보다 많은 재확인: 판정 기록을 확인하세요.");
      const concept: RubricConcept | undefined = rubric.concepts.find((c) => c.concept_id === view.concept?.id);
      assert.ok(concept);
      const phase: CheckpointView["state"] = view.state;
      // Explicitly labelled synthetic answers, not a claim about real learners.
      const answer = concept.key_points.map((k) => k.point).join(" ");
      view = await request<CheckpointView>(`${phase === "awaiting_recheck" ? "재확인 정답" : "정답 채점"}: ${concept.concept_id}`, messages, { text: answer });
      const saved: ConceptResultRow | undefined = repo.listResults(id).find((r) => r.concept_id === concept.concept_id);
      assert.equal(phase === "awaiting_recheck" ? saved?.recheck_verdict : saved?.verdict, "correct", `루브릭 핵심 요소를 모두 쓴 정답: ${concept.concept_id}`);
    }
    assert.equal(view.state, "completed");
    assert.equal(view.result?.understanding, 1);
    assert.equal(view.result?.unlocked, true);
    assert.equal(view.result?.concepts.length, rubric.concepts.length);
    assert.ok(view.result?.concepts.every((c) => c.score === 1));
    assert.equal(repo.listResults(id).length, rubric.concepts.length);
    const restored = await request<CheckpointView>("완료 기록 복원", `/api/checkpoints/${id}`);
    assert.equal(restored.state, "completed");
    assert.deepEqual(restored.result, view.result);
    assert.ok(restored.history?.some((m) => m.type === "recheck_question"));
    const progress = await request<SectionProgressView>("진도 저장", "/api/sections/ironmaking/progress");
    assert.equal(progress.unlocked, true);
    assert.equal(progress.understanding, 1);
    assert.equal(progress.in_progress_attempt_id, null);
    const summary = { mode, passed: true, provider: "Ollama", model, base_url: baseUrl,
      database: ":memory:", concepts: rubric.concepts.length, state: view.state, result: view.result,
      elapsed_ms: Date.now() - started, calls: client.calls, misconceptions: repo.listMisconceptions(user), records,
      note: "제선 전체 API 흐름과 루브릭 기반 합성 답변 검증. 사람 답변의 채점 정확도 평가는 별도입니다." };
    log({ event: "summary", ...summary });
    console.log(JSON.stringify(summary, null, 2));
    writeFileSync(`${records}.summary.json`, JSON.stringify(summary, null, 2) + "\n");
  } catch (error) {
    log({ event: "failure", passed: false, elapsed_ms: Date.now() - started, error: (error as Error).message, calls: client.calls });
    console.error(`실패 기록: ${records}`);
    throw error;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
}

async function main() {
  assert.ok(mode === "evaluator" || mode === "checkpoint", "--mode는 evaluator 또는 checkpoint입니다.");
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, "--timeout-ms는 양수입니다.");
  // Ignore stale vLLM/Gemini model names in .env. These commands explicitly select Ollama.
  process.env.LLM_PROVIDER = "ollama";
  process.env.PRIVATE_LLM_ONLY = "1";
  process.env.OLLAMA_MODEL = model;
  process.env.OLLAMA_BASE_URL = baseUrl;
  const native = new OllamaClient({ model, baseUrl, timeoutMs });
  const connection = await native.checkConnection();
  assert.ok(connection.connected, `Ollama 연결 상태: ${connection.reason}. Ollama 앱과 모델 다운로드를 확인하세요.`);
  console.log(`Ollama ${mode}: ${model} (${baseUrl})`);
  const client = new MeasuredClient(native);
  if (mode === "checkpoint") await runCheckpoint(client);
  else await runEvaluator(client);
}

await main().catch((error: unknown) => { console.error((error as Error).message); process.exitCode = 1; });
