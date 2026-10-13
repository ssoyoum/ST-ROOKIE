import type { Section } from "../checkpoint/types.js";
import type { LearningRepository } from "./repository.js";
import { latestPerConcept } from "./repository.js";
import type { Retriever } from "../../../llm/src/retrieval.js";
import { isLearningToolError, parseLearningToolCall, type LearningToolCall, type LearningToolError, type LearningToolResult } from "../../../llm/src/learning-tools.js";
import type { SceneCatalog } from "../../../llm/src/learning-agent.js";

export interface LearningToolContext {
  userId: string;
  section: Section;
  repository: LearningRepository;
  retriever: Retriever;
  scene?: SceneCatalog;
  conceptIds?: ReadonlySet<string>;
}

export function executeLearningTool(raw: unknown, context: LearningToolContext): Promise<LearningToolResult | LearningToolError> {
  const parsed = parseLearningToolCall(raw, context.section);
  if (isLearningToolError(parsed)) return Promise.resolve(parsed);
  return Promise.resolve(executeParsedLearningTool(parsed, context));
}

function executeParsedLearningTool(call: LearningToolCall, context: LearningToolContext): LearningToolResult | LearningToolError {
  switch (call.tool) {
    case "get_learning_state":
      return {
        ok: true,
        call_id: call.call_id,
        tool: call.tool,
        result: { section: context.section, open_misconceptions: latestPerConcept(context.repository.openMisconceptions(context.userId, context.section)).map(({ concept_id, summary, source }) => ({ concept_id, summary, source })) },
      };
    case "search_materials": {
      const chunks = context.retriever.retrieve(context.section, call.arguments.query, { process_id: context.section, equipment_id: call.arguments.equipment_id ?? null });
      return { ok: true, call_id: call.call_id, tool: call.tool, result: { chunks: chunks.map(({ id, title, text, source_ids, score }) => ({ id, title, text, source_ids, score })) } };
    }
    case "show_equipment": {
      const process = context.scene?.processes.find((candidate) => candidate.id === context.section);
      const equipment = process?.equipment.find((candidate) => candidate.id === call.arguments.equipment_id);
      if (!equipment) return { ok: false, call_id: call.call_id, tool: call.tool, error: "unknown_equipment", message: "현재 공정에 없는 설비입니다." };
      return { ok: true, call_id: call.call_id, tool: call.tool, result: { actions: [{ type: "focus", target_id: equipment.id }, { type: "highlight", target_id: equipment.id }], equipment } };
    }
    case "create_quiz":
      if (context.conceptIds && !context.conceptIds.has(call.arguments.concept_id)) return { ok: false, call_id: call.call_id, tool: call.tool, error: "unknown_concept", message: "현재 루브릭에 없는 개념입니다." };
      return { ok: true, call_id: call.call_id, tool: call.tool, result: { status: "question_ready", concept_id: call.arguments.concept_id, question: call.arguments.question } };
    case "evaluate_answer":
      if (context.conceptIds && !context.conceptIds.has(call.arguments.concept_id)) return { ok: false, call_id: call.call_id, tool: call.tool, error: "unknown_concept", message: "현재 루브릭에 없는 개념입니다." };
      return { ok: true, call_id: call.call_id, tool: call.tool, result: { status: "needs_evaluator", concept_id: call.arguments.concept_id, question: call.arguments.question, answer: call.arguments.answer } };
  }
}
