import assert from "node:assert/strict";
import test from "node:test";
import { loadFineTuneExamples, splitFineTuneExamples } from "../../llm/finetune/prepare.js";

test("fine-tuning examples validate and split by group", () => {
  const examples = loadFineTuneExamples();
  const split = splitFineTuneExamples(examples);
  assert.equal(Object.values(split).flat().length, examples.length);
  assert.ok(examples.every((example) => example.messages.at(-1)?.role === "assistant"));
  const groups = new Map<string, string>();
  for (const [name, rows] of Object.entries(split)) for (const row of rows) {
    const previous = groups.get(row.group);
    if (previous && previous !== name) assert.fail(`group ${row.group}가 여러 split에 들어갔습니다.`);
    groups.set(row.group, name);
  }
});
