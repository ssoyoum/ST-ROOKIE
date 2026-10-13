const noProbe = process.argv.includes("--no-probe");
const provider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
const failures = [];

if (provider !== "vllm") failures.push("LLM_PROVIDER=vllm이 필요합니다.");
if (process.env.PRIVATE_LLM_ONLY !== "1") failures.push("PRIVATE_LLM_ONLY=1이 필요합니다.");
if (!process.env.LLM_BASE_URL) failures.push("LLM_BASE_URL이 없습니다.");
if (!process.env.LLM_MODEL) failures.push("LLM_MODEL이 없습니다.");
if (process.env.GEMINI_API_KEY || process.env.GEMINI_MODEL) failures.push("운영 환경에 GEMINI_API_KEY/GEMINI_MODEL을 남기면 안 됩니다.");

if (failures.length) {
  console.error("Private LLM cutover 검증 실패:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (noProbe) {
  console.log("Private LLM 설정 검증 통과(--no-probe). 서버 연결은 확인하지 않았습니다.");
} else {
  const base = process.env.LLM_BASE_URL.replace(/\/$/, "");
  const headers = process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {};
  try {
    const response = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const ids = Array.isArray(body?.data) ? body.data.map((item) => item?.id) : [];
    if (!ids.includes(process.env.LLM_MODEL)) throw new Error(`모델 목록에 ${process.env.LLM_MODEL}이 없습니다.`);
    console.log(`Private LLM cutover 검증 통과: ${process.env.LLM_MODEL}`);
  } catch (error) {
    console.error(`Private LLM 서버 연결 검증 실패: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  }
}
