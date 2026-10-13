import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const Message = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().trim().min(1) });
export const FineTuneExample = z.object({ id: z.string().min(1), group: z.string().min(1), source: z.enum(["curated_synthetic", "curated_human"]), messages: z.array(Message).min(3) });
export type FineTuneExample = z.infer<typeof FineTuneExample>;

export function loadFineTuneExamples(path = join(process.cwd(), "llm", "finetune", "examples.jsonl")): FineTuneExample[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line, i) => {
    const parsed = FineTuneExample.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`${path}:${i + 1} 형식 오류`);
    const roles = parsed.data.messages.map((message) => message.role);
    if (roles[0] !== "system" || roles.at(-1) !== "assistant") throw new Error(`${path}:${i + 1} system → user → assistant 순서를 확인하세요.`);
    return parsed.data;
  });
}

export function splitFineTuneExamples(examples: FineTuneExample[]): Record<"train" | "validation" | "test", FineTuneExample[]> {
  const out: Record<"train" | "validation" | "test", FineTuneExample[]> = { train: [], validation: [], test: [] };
  for (const example of examples) {
    const bucket = Number.parseInt(createHash("sha256").update(example.group).digest("hex").slice(0, 8), 16) % 10;
    out[bucket === 0 ? "test" : bucket === 1 ? "validation" : "train"].push(example);
  }
  return out;
}

export function prepareFineTuneData(inputPath = join(process.cwd(), "llm", "finetune", "examples.jsonl"), outputDir = join(process.cwd(), "data", "finetune")) {
  const split = splitFineTuneExamples(loadFineTuneExamples(inputPath));
  mkdirSync(outputDir, { recursive: true });
  for (const [name, rows] of Object.entries(split)) writeFileSync(join(outputDir, `${name}.jsonl`), rows.map((row) => JSON.stringify({ messages: row.messages })).join("\n") + (rows.length ? "\n" : ""));
  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify({ input: inputPath, counts: Object.fromEntries(Object.entries(split).map(([name, rows]) => [name, rows.length])), groups_are_atomic: true }, null, 2) + "\n");
  return split;
}

if (process.argv[1]?.endsWith("prepare.js")) {
  const split = prepareFineTuneData();
  console.log(`Fine-tuning 데이터 준비 완료: train=${split.train.length}, validation=${split.validation.length}, test=${split.test.length}`);
}
