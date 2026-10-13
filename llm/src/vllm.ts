import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { GeminiCallError } from "./gemini.js";
import type { GenerateRequest, LlmClient } from "./llm-client.js";
import { toJsonSchema } from "./json-schema.js";

export interface VllmOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  beforeCall?: () => void;
}

export const DEFAULT_VLLM_BASE_URL = "http://localhost:8000/v1";

/** Gemini를 제거하기 전 개발용으로 사용할 OpenAI 호환 vLLM 클라이언트. */
export class VllmClient implements LlmClient {
  constructor(private readonly options: VllmOptions = {}) {}

  async generate(req: GenerateRequest): Promise<string> {
    const baseUrl = (this.options.baseUrl ?? process.env.LLM_BASE_URL ?? DEFAULT_VLLM_BASE_URL).replace(/\/$/, "");
    const model = this.options.model ?? process.env.LLM_MODEL;
    if (!model) throw new LlmUnavailableError("LLM_MODEL이 설정되지 않았습니다.", 503);
    const doFetch = this.options.fetch ?? fetch;
    this.options.beforeCall?.();

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = this.options.apiKey ?? process.env.LLM_API_KEY;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
          temperature: req.temperature,
          max_tokens: req.maxOutputTokens,
          ...(req.responseSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: { name: "llm_response", schema: toJsonSchema(req.responseSchema) },
                },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      });
    } catch (error) {
      const e = error as Error;
      const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
      throw new GeminiCallError(`vLLM 연결 실패: ${e?.message ?? String(error)}`, timeout ? "timeout" : "network");
    }
    if (!response.ok) {
      throw new GeminiCallError(`vLLM HTTP ${response.status}`, response.status === 429 ? "rate_limit" : "http", response.status);
    }

    let result: { choices?: { message?: { content?: string | { text?: string }[] | null } }[] };
    try {
      result = (await response.json()) as typeof result;
    } catch (error) {
      throw error instanceof SyntaxError
        ? new GeminiCallError("vLLM 응답이 JSON이 아닙니다.", "http", response.status)
        : new GeminiCallError(`vLLM 응답 읽기 실패: ${(error as Error).message}`, "network");
    }
    const content = result.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
    return "";
  }
}
