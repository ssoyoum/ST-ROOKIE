import assert from "node:assert/strict";
import test from "node:test";
import { parseLearningToolCall } from "../../llm/src/learning-tools.js";

test("learning tool calls cannot cross the active section", () => {
  const result = parseLearningToolCall({ tool: "search_materials", call_id: "1", arguments: { section: "rolling", query: "권취기" } }, "ironmaking");
  assert.equal("ok" in result, true);
  if ("ok" in result) assert.equal(result.ok, false);
  if ("error" in result) assert.equal(result.error, "forbidden_section");
});

test("learning tool calls accept only the declared tool contract", () => {
  const result = parseLearningToolCall({ tool: "show_equipment", call_id: "2", arguments: { section: "ironmaking", equipment_id: "blast_furnace" } }, "ironmaking");
  assert.equal("ok" in result, false);
});
