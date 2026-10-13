import type { LearningInput } from "./learning-agent.js";

export const LOCAL_CONTEXT_LIMITS = { chunks: 3, sourceChars: 2200, turns: 2, questionChars: 400, answerChars: 500, notes: 3 } as const;

const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max)} [이전 대화 일부 생략]`;

/** Reduce inference input without truncating evidence or changing the current question. */
export function compactLearningInput(input: LearningInput): LearningInput {
  let used = 0;
  const chunks = input.chunks.filter((c) => {
    const length = c.title.length + c.text.length;
    if (used + length > LOCAL_CONTEXT_LIMITS.sourceChars) return false;
    used += length;
    return true;
  }).slice(0, LOCAL_CONTEXT_LIMITS.chunks);
  const history = input.history.slice(-LOCAL_CONTEXT_LIMITS.turns).map((t) => ({
    question: clip(t.question, LOCAL_CONTEXT_LIMITS.questionChars), answer: clip(t.answer, LOCAL_CONTEXT_LIMITS.answerChars),
  }));
  const referents = [input.question, ...history.map((t) => `${t.question} ${t.answer}`)].join(" ").toLowerCase();
  const current = input.screen.process_id ?? input.section;
  const relevantEquipment = new Set([input.screen.equipment_id, ...chunks.flatMap((c) => c.tags)]);
  const scene = input.scene && {
    processes: input.scene.processes.map((p) => ({ ...p, equipment: p.equipment.filter((e) => {
      // Only equipment tied to evidence, the current selection or explicit referents is allowed.
      const names = [e.id, e.name.split(/[\s(·]/)[0], ...(e.name.match(/[A-Z]{2,}/g) ?? [])];
      return (p.id === current && relevantEquipment.has(e.id)) || names.some((name) => name.length > 1 && referents.includes(name.toLowerCase()));
    }) })),
  };
  return { ...input, chunks, history, scene,
    openMisconceptions: input.openMisconceptions.slice(-LOCAL_CONTEXT_LIMITS.notes).map((m) => ({ ...m, summary: clip(m.summary, 200) })),
  };
}
