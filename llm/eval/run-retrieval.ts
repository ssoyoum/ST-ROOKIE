import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Retriever, type Screen } from "../src/retrieval.js";

export const RETRIEVAL_SET_PATH = join(process.cwd(), "llm", "eval", "retrieval", "ironmaking.jsonl");

export const RetrievalCase = z.object({
  id: z.string().min(1),
  section: z.enum(["ironmaking", "steelmaking", "continuous_casting", "rolling"]),
  query: z.string().min(1),
  screen: z.object({ process_id: z.string().optional(), equipment_id: z.string().optional() }).optional(),
  expected_source_ids: z.array(z.string()),
});
export type RetrievalCase = z.infer<typeof RetrievalCase>;

export function loadRetrievalSet(path = RETRIEVAL_SET_PATH): RetrievalCase[] {
  const rows = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim())
    .map(({ line, index }) => {
      const parsed = RetrievalCase.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`${path}:${index + 1} 형식 오류`);
      return parsed.data;
    });
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${path}: 케이스 id가 겹칩니다: ${row.id}`);
    ids.add(row.id);
  }
  return rows;
}

export interface RetrievalScore {
  id: string;
  expected: string[];
  retrieved: string[];
  hit: boolean;
  reciprocalRank: number;
}

export function scoreRetrieval(c: RetrievalCase, retriever: Retriever): RetrievalScore {
  const results = retriever.retrieve(c.section, c.query, (c.screen ?? {}) as Screen);
  const expected = new Set(c.expected_source_ids);
  const retrieved = [...new Set(results.flatMap((r) => r.source_ids))];
  const rank = results.findIndex((r) => r.source_ids.some((id) => expected.has(id)));
  return { id: c.id, expected: [...expected], retrieved, hit: expected.size === 0 ? results.length === 0 : rank >= 0, reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0 };
}

function pct(value: number, total: number): string {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "-";
}

function main(): void {
  const cases = loadRetrievalSet();
  const retriever = new Retriever();
  const scores = cases.map((c) => scoreRetrieval(c, retriever));
  const hits = scores.filter((s) => s.hit).length;
  const mrr = scores.reduce((sum, s) => sum + s.reciprocalRank, 0) / scores.length;
  console.log(`검색 세트: ${cases.length}개`);
  console.log(`Recall@5(케이스): ${hits}/${cases.length} (${pct(hits, cases.length)})`);
  console.log(`MRR: ${mrr.toFixed(3)}`);
  for (const miss of scores.filter((s) => !s.hit)) console.log(`- ${miss.id}: 기대 ${miss.expected.join(", ") || "빈 결과"} / 검색 ${miss.retrieved.join(", ") || "빈 결과"}`);
}

if (process.argv[1]?.endsWith("run-retrieval.js")) main();
