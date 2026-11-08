import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { GeminiCallError, readLines } from "./gemini.js";
import { toJsonSchema } from "./json-schema.js";
import type { GenerateRequest, LlmClient } from "./llm-client.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:3b";

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  beforeCall?: () => void;
  contextLength?: number;
  keepAlive?: string | number;
}

export function ollamaRuntimeSettings(options: OllamaOptions = {}) {
  const contextLength = Number(options.contextLength ?? process.env.OLLAMA_NUM_CTX ?? 4096);
  if (!Number.isInteger(contextLength) || contextLength < 1024) throw new Error("OLLAMA_NUM_CTX는 1024 이상의 정수입니다.");
  return { contextLength, keepAlive: options.keepAlive ?? process.env.OLLAMA_KEEP_ALIVE ?? "20m" };
}

export function ollamaSettings(options: OllamaOptions = {}) {
  return {
    baseUrl: (options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? process.env.LLM_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, ""),
    model: options.model ?? process.env.OLLAMA_MODEL ?? process.env.LLM_MODEL ?? DEFAULT_OLLAMA_MODEL,
  };
}

function connectionError(error: unknown): GeminiCallError {
  const e = error as Error;
  const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
  return new GeminiCallError(`Ollama 연결 실패: ${e?.message ?? String(error)}`, timeout ? "timeout" : "network");
}

/** Native Ollama API: schema-constrained output with the same server-side validation as Gemini. */
export class OllamaClient implements LlmClient {
  constructor(private readonly options: OllamaOptions = {}) {}

  private headers(): Record<string, string> {
    const apiKey = this.options.apiKey ?? process.env.LLM_API_KEY;
    return { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  }

  async checkConnection(): Promise<{ connected: boolean; reason: "ready" | "model_missing" | "unreachable" }> {
    const { baseUrl, model } = ollamaSettings(this.options);
    try {
      const response = await (this.options.fetch ?? fetch)(`${baseUrl}/api/tags`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      if (!response.ok) return { connected: false, reason: "unreachable" };
      const body = await response.json() as { models?: { name?: string; model?: string }[] };
      const names = new Set([model, ...(model.includes(":") ? [] : [`${model}:latest`])]);
      const connected = Array.isArray(body.models) && body.models.some((m) => names.has(m.name ?? "") || names.has(m.model ?? ""));
      return { connected, reason: connected ? "ready" : "model_missing" };
    } catch {
      return { connected: false, reason: "unreachable" };
    }
  }

  /** Load the same context configuration used by inference. This does not generate or consume learner quota. */
  async warmUp(): Promise<void> {
    const { baseUrl, model } = ollamaSettings(this.options);
    const { contextLength, keepAlive } = ollamaRuntimeSettings(this.options);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${baseUrl}/api/chat`, {
        method: "POST", headers: this.headers(),
        body: JSON.stringify({ model, messages: [], stream: false, keep_alive: keepAlive, options: { num_ctx: contextLength } }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 180_000),
      });
    } catch (error) { throw connectionError(error); }
    if (!response.ok) throw new GeminiCallError(`Ollama 미리 로드 실패: HTTP ${response.status}`, "http", response.status);
    const body = await response.json() as { done?: boolean; error?: string };
    if (body.error || body.done !== true) throw new GeminiCallError("Ollama 미리 로드 응답이 올바르지 않습니다.", "http");
  }

  async generate(req: GenerateRequest): Promise<string> {
    const { baseUrl, model } = ollamaSettings(this.options);
    if (!model) throw new LlmUnavailableError("Ollama 모델을 설정해 주세요.", 503);
    const schema = req.responseSchema ? toJsonSchema(req.responseSchema) : undefined;
    const { contextLength, keepAlive } = ollamaRuntimeSettings(this.options);
    const system = schema
      ? `${req.system}\n\n출력은 제공된 JSON Schema를 따르는 JSON 객체 하나입니다. 설명은 한국어로 작성하세요.`
      : req.system;
    this.options.beforeCall?.();
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: req.prompt }],
          // onText가 있으면 NDJSON으로 조각마다 받는다(학습 모드 답을 화면에 바로 보여 준다).
          stream: !!req.onText,
          keep_alive: keepAlive,
          ...(schema ? { format: schema } : {}),
          options: { temperature: req.temperature, num_predict: req.maxOutputTokens, num_ctx: contextLength },
        }),
        signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(this.options.timeoutMs ?? 180_000)]) : AbortSignal.timeout(this.options.timeoutMs ?? 180_000),
      });
    } catch (error) { throw connectionError(error); }
    if (!response.ok) throw new GeminiCallError(`Ollama HTTP ${response.status}`, response.status === 429 ? "rate_limit" : "http", response.status);
    if (req.onText) {
      let text = "";
      try {
        await readLines(response, (line) => {
          const part = JSON.parse(line) as { message?: { content?: unknown }; error?: unknown };
          if (part.error) throw new GeminiCallError(`Ollama 오류: ${String(part.error)}`, "http", response.status);
          if (typeof part.message?.content === "string" && part.message.content) {
            text += part.message.content;
            req.onText!(text);
          }
        });
      } catch (error) {
        if (error instanceof GeminiCallError) throw error;
        if (error instanceof SyntaxError) throw new GeminiCallError("Ollama 응답이 JSON이 아닙니다.", "http", response.status);
        throw connectionError(error);
      }
      if (!text.trim()) throw new GeminiCallError("Ollama 응답이 비어 있거나 형식이 올바르지 않습니다.", "http", response.status);
      return text;
    }
    let body: { message?: { content?: unknown }; error?: unknown };
    try { body = await response.json() as typeof body; }
    catch (error) {
      if (error instanceof SyntaxError) throw new GeminiCallError("Ollama 응답이 JSON이 아닙니다.", "http", response.status);
      throw connectionError(error);
    }
    if (typeof body.message?.content !== "string" || !body.message.content.trim() || body.error) {
      throw new GeminiCallError("Ollama 응답이 비어 있거나 형식이 올바르지 않습니다.", "http", response.status);
    }
    return body.message.content;
  }
}
