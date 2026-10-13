import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, OllamaClient, ollamaRuntimeSettings } from "../src/ollama.js";

const client = new OllamaClient({ model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
  baseUrl: process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL });
const started = Date.now();
await client.warmUp().then(() => console.log(JSON.stringify({ loaded: true, model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
  ...ollamaRuntimeSettings(), elapsed_ms: Date.now() - started }))).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
