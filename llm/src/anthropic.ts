// Claude(Anthropic Messages API) 호출. GeminiClient·OllamaClient와 같은 LlmClient 계약이라 튜터·평가자·학습 에이전트가 provider를 몰라도 된다(provider.ts가 고른다).
// - responseSchema는 JSON Schema로 바꿔 구조화 출력(output_config.format)에 넣는다. 형식 검증은 Gemini와 같이 서버가 한 번 더 한다.
// - 생각(thinking)은 끈다: 기존 출력 상한(200~512토큰)이 Gemini 기준이라 생각 토큰이 답을 잘라 먹고, 채팅은 응답 속도가 중요하다.
// - temperature는 보내지 않는다(현재 모델은 기본값 외 sampling 값을 400으로 막는다).
// - SDK 재시도는 끈다(maxRetries 0). 재시도는 Gemini와 같이 호출하는 쪽(평가 스크립트)이 정하고, 호출 수 제한(beforeCall)도 실제 호출 수와 맞는다.
// - 오류는 GeminiCallError(reason: rate_limit·timeout·network·http)로 올려 보내 재시도·오류 처리를 Gemini와 같이 탄다.
// 설정: ANTHROPIC_API_KEY, ANTHROPIC_MODEL(기본 claude-haiku-5-5), ANTHROPIC_EFFORT(low|medium|high, 기본 low), ANTHROPIC_TIMEOUT_MS(기본 60000).
import Anthropic from "@anthropic-ai/sdk";
import { performance } from "node:perf_hooks";
import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { GeminiCallError } from "./gemini.js";
import { toJsonSchema } from "./json-schema.js";
import type { GenerateRequest, LlmClient } from "./llm-client.js";
import { currentTrace, type LlmCallRecord } from "./trace.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
const EFFORTS = ["low", "medium", "high"] as const;
type Effort = (typeof EFFORTS)[number];

export interface AnthropicOptions {
  apiKey?: string;
  model?: string;
  effort?: Effort;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 실제 호출 직전에 부른다(예: 사용자별 호출 수 제한). 예외를 던지면 호출하지 않는다. */
  beforeCall?: () => void;
}

export function anthropicSettings(options: AnthropicOptions = {}) {
  const effort = (options.effort ?? (process.env.ANTHROPIC_EFFORT || "low").trim().toLowerCase()) as Effort;
  if (!EFFORTS.includes(effort)) throw new Error(`ANTHROPIC_EFFORT는 ${EFFORTS.join("|")} 중 하나입니다: ${effort}`);
  const timeout = Number(options.timeoutMs ?? process.env.ANTHROPIC_TIMEOUT_MS ?? 60_000);
  return {
    model: options.model ?? (process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL),
    effort,
    timeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : 60_000,
  };
}

/** 구조화 출력은 모든 object에 additionalProperties: false가 있어야 한다. */
export function toClaudeSchema(responseSchema: object): Record<string, unknown> {
  const strict = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strict);
    if (!value || typeof value !== "object") return value;
    const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "properties" && item && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).map(([name, property]) => [name, strict(property)]))
      : strict(item)]));
    const type = schema.type;
    if (type === "object" || (Array.isArray(type) && type.includes("object"))) schema.additionalProperties = false;
    return schema;
  };
  return strict(toJsonSchema(responseSchema)) as Record<string, unknown>;
}

function callError(error: unknown): GeminiCallError {
  if (error instanceof GeminiCallError) return error;
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) return new GeminiCallError(`Claude 시간 초과: ${error.message}`, "timeout");
  if (error instanceof Anthropic.APIConnectionError) return new GeminiCallError(`Claude 연결 실패: ${error.message}`, "network");
  if (error instanceof Anthropic.RateLimitError) return new GeminiCallError("Claude HTTP 429", "rate_limit", 429);
  if (error instanceof Anthropic.APIError) return new GeminiCallError(`Claude HTTP ${error.status}: ${error.message}`, "http", error.status);
  const e = error as Error;
  return new GeminiCallError(`Claude 연결 실패: ${e?.message ?? String(error)}`, e?.name === "AbortError" ? "timeout" : "network");
}

export class AnthropicClient implements LlmClient {
  constructor(private readonly options: AnthropicOptions = {}) {}

  async generate(req: GenerateRequest): Promise<string> {
    // 서버가 키 없이도 시작할 수 있도록 호출할 때 읽는다.
    const apiKey = this.options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new LlmUnavailableError("ANTHROPIC_API_KEY가 설정되지 않았습니다.", 503);
    const settings = anthropicSettings(this.options);
    this.options.beforeCall?.();
    const trace = currentTrace();
    const started = performance.now();
    const usage: { tokens?: LlmCallRecord["tokens"] } = {};
    const label = `anthropic:${settings.model}`;
    try {
      const text = await this.call(req, apiKey, settings, usage);
      trace?.llm({ model: label, ms: Math.round(performance.now() - started), ok: true, streamed: !!req.onText, ...usage });
      return text;
    } catch (error) {
      const failure = callError(error);
      trace?.llm({ model: label, ms: Math.round(performance.now() - started), ok: false, streamed: !!req.onText, failure: failure.reason, ...(failure.httpStatus ? { http_status: failure.httpStatus } : {}) });
      throw failure;
    }
  }

  private async call(req: GenerateRequest, apiKey: string, settings: ReturnType<typeof anthropicSettings>, usage: { tokens?: LlmCallRecord["tokens"] }): Promise<string> {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: settings.timeoutMs, ...(this.options.fetch ? { fetch: this.options.fetch } : {}) });
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: settings.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      thinking: { type: "disabled" },
      output_config: {
        effort: settings.effort,
        ...(req.responseSchema ? { format: { type: "json_schema", schema: toClaudeSchema(req.responseSchema) } } : {}),
      },
    };
    // 시험 작업이 취소되면(req.signal) 추론도 끊는다.
    const requestOptions = req.signal ? { signal: req.signal } : {};
    let message: Anthropic.Message;
    if (req.onText) {
      let text = "";
      const stream = client.messages.stream(params, requestOptions);
      stream.on("text", (delta) => {
        text += delta;
        req.onText!(text);
      });
      message = await stream.finalMessage();
    } else {
      message = await client.messages.create(params, requestOptions);
    }
    usage.tokens = { prompt: message.usage.input_tokens, output: message.usage.output_tokens, total: message.usage.input_tokens + message.usage.output_tokens };
    if (message.stop_reason === "refusal") throw new GeminiCallError("Claude가 답하지 않았습니다(refusal).", "http", 200);
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    if (!text.trim()) throw new GeminiCallError("Claude 응답이 비어 있습니다.", "http", 200);
    return text;
  }
}
