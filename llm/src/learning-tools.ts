import { z } from "zod";
import type { Section } from "../../backend/src/checkpoint/types.js";

export const LEARNING_TOOL_NAMES = ["get_learning_state", "search_materials", "show_equipment", "create_quiz", "evaluate_answer"] as const;
export type LearningToolName = (typeof LEARNING_TOOL_NAMES)[number];

const Base = z.object({ tool: z.enum(LEARNING_TOOL_NAMES), call_id: z.string().min(1).max(80) });
export const LearningToolCall = z.discriminatedUnion("tool", [
  Base.extend({ tool: z.literal("get_learning_state"), arguments: z.object({ section: z.string().optional() }) }),
  Base.extend({ tool: z.literal("search_materials"), arguments: z.object({ section: z.string(), query: z.string().trim().min(1).max(1000), equipment_id: z.string().nullable().optional() }) }),
  Base.extend({ tool: z.literal("show_equipment"), arguments: z.object({ section: z.string(), equipment_id: z.string().min(1) }) }),
  Base.extend({ tool: z.literal("create_quiz"), arguments: z.object({ section: z.string(), concept_id: z.string().min(1), question: z.string().trim().min(1).max(1000) }) }),
  Base.extend({ tool: z.literal("evaluate_answer"), arguments: z.object({ section: z.string(), concept_id: z.string().min(1), question: z.string().trim().min(1).max(1000), answer: z.string().trim().min(1).max(4000) }) }),
]);
export type LearningToolCall = z.infer<typeof LearningToolCall>;

export interface LearningToolError {
  ok: false;
  call_id: string;
  tool: LearningToolName;
  error: "invalid_arguments" | "forbidden_section" | "unknown_equipment" | "unknown_concept" | "execution_failed";
  message: string;
}

export interface LearningToolResult<T = unknown> {
  ok: true;
  call_id: string;
  tool: LearningToolName;
  result: T;
}

export function isLearningToolError(value: LearningToolCall | LearningToolError): value is LearningToolError {
  return "ok" in value && value.ok === false;
}

/** 모델이 요청한 도구를 서버가 실행하기 전에 공정 범위를 검증한다. */
export function parseLearningToolCall(raw: unknown, section: Section): LearningToolCall | LearningToolError {
  const parsed = LearningToolCall.safeParse(raw);
  if (!parsed.success) return { ok: false, call_id: "unknown", tool: "get_learning_state", error: "invalid_arguments", message: "도구 호출 형식이 올바르지 않습니다." };
  const call = parsed.data;
  const requested = "section" in call.arguments ? call.arguments.section : undefined;
  if (requested && requested !== section) return { ok: false, call_id: call.call_id, tool: call.tool, error: "forbidden_section", message: "현재 학습 공정 밖의 도구 호출은 허용하지 않습니다." };
  return call;
}

export function toolSection(value: string, section: Section): value is Section {
  return value === section;
}
