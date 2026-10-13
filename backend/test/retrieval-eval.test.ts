import assert from "node:assert/strict";
import test from "node:test";
import { loadRetrievalSet, scoreRetrieval } from "../../llm/eval/run-retrieval.js";
import { Retriever } from "../../llm/src/retrieval.js";

test("retrieval evaluation set is valid and the current baseline is measurable", () => {
  const cases = loadRetrievalSet();
  assert.ok(cases.length >= 5);
  const scores = cases.map((c) => scoreRetrieval(c, new Retriever()));
  assert.equal(scores.length, cases.length);
  assert.ok(scores.some((score) => score.hit));
  assert.ok(scores.some((score) => score.expected.length === 0));
});
