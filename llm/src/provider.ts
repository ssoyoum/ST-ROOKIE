import { GeminiClient, type GeminiOptions } from "./gemini.js";
import type { LlmClient } from "./llm-client.js";
import { VllmClient, type VllmOptions } from "./vllm.js";
import { OllamaClient, ollamaSettings, type OllamaOptions } from "./ollama.js";

export type LlmProvider = "gemini" | "vllm" | "ollama";

export interface LlmProviderInfo {
  provider: LlmProvider;
  model: string | null;
  baseUrl: string | null;
}

export interface LlmFactoryOptions {
  gemini?: GeminiOptions;
  vllm?: VllmOptions;
  ollama?: OllamaOptions;
}

export function configuredProvider(): LlmProvider {
  const value = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  if (value !== "gemini" && value !== "vllm" && value !== "ollama") throw new Error(`지원하지 않는 LLM_PROVIDER: ${value}`);
  if (process.env.PRIVATE_LLM_ONLY === "1" && value === "gemini") throw new Error("PRIVATE_LLM_ONLY=1이면 Gemini를 사용할 수 없습니다.");
  return value;
}

export function providerInfo(): LlmProviderInfo {
  const provider = configuredProvider();
  if (provider === "ollama") {
    const { model, baseUrl } = ollamaSettings();
    return { provider, model, baseUrl };
  }
  return provider === "vllm"
    ? { provider, model: process.env.LLM_MODEL ?? null, baseUrl: process.env.LLM_BASE_URL ?? null }
    : { provider, model: process.env.GEMINI_MODEL ?? null, baseUrl: null };
}

export function createLlmClient(options: LlmFactoryOptions = {}): LlmClient {
  const provider = configuredProvider();
  if (provider === "ollama") return new OllamaClient(options.ollama);
  return provider === "vllm" ? new VllmClient(options.vllm) : new GeminiClient(options.gemini);
}
