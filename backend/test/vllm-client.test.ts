import assert from "node:assert/strict";
import test from "node:test";
import { VllmClient } from "../../llm/src/vllm.js";

test("vLLM client sends OpenAI-compatible chat completion and returns text", async () => {
  let requestUrl = "";
  let requestBody: any;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requestUrl = url;
    requestBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
  }) as typeof fetch;

  const client = new VllmClient({ baseUrl: "http://llm.test/v1", model: "steel-tutor", apiKey: "internal", fetch: fetchImpl });
  const output = await client.generate({ system: "system", prompt: "question", temperature: 0.2, maxOutputTokens: 80, responseSchema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } } } });

  assert.equal(output, '{"ok":true}');
  assert.equal(requestUrl, "http://llm.test/v1/chat/completions");
  assert.equal(requestBody.model, "steel-tutor");
  assert.deepEqual(requestBody.messages, [{ role: "system", content: "system" }, { role: "user", content: "question" }]);
  assert.equal(requestBody.response_format.type, "json_schema");
  assert.equal(requestBody.response_format.json_schema.schema.type, "object");
  assert.equal(requestBody.response_format.json_schema.schema.properties.ok.type, "boolean");
});

test("vLLM client maps HTTP failures to the existing LLM error contract", async () => {
  const client = new VllmClient({ baseUrl: "http://llm.test/v1", model: "steel-tutor", fetch: (async () => new Response("", { status: 503 })) as typeof fetch });
  await assert.rejects(client.generate({ system: "", prompt: "", temperature: 0, maxOutputTokens: 1 }), /vLLM HTTP 503/);
});
