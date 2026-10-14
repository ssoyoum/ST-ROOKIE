// Real Gemini grading and retry QA; use a dedicated QA server/database.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '../data/browser-tools/node_modules/playwright/index.mjs';

const base = process.env.RETRY_QA_URL || 'http://127.0.0.1:3013';
const stamp = Date.now(), started = Date.now();
const signup = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `retry_${stamp}`, password: `retry-${stamp}`, name: '재도전 검증', employee_no: `QA${stamp}` }) });
assert.equal(signup.status, 201);
const { token, user } = await signup.json();
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const request = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { ...headers, ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(r.ok, `${method} ${path}: ${r.status}`); return r.json();
};
async function finish(job) {
  const deadline = Date.now() + 240000; let phase = '';
  while (Date.now() < deadline) {
    job = await request('GET', `/api/exam-jobs/${job.id}`);
    if (job.phase !== phase) { phase = job.phase; console.log(`exam phase: ${phase}`); }
    if (job.state === 'succeeded') return job.result;
    if (['failed', 'cancelled'].includes(job.state)) throw Error(JSON.stringify(job.error));
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw Error('exam job exceeded the QA timeout');
}
assert.equal((await request('GET', '/api/status')).provider, 'Gemini');
let view = await finish(await request('POST', '/api/exams', { section: 'ironmaking' }));
view = await finish(await request('POST', `/api/exams/${view.attempt_id}/commands`, { action: 'answer', text: '준비됐어요.' }));
let turns = 0;
while (['awaiting_answer', 'awaiting_recheck'].includes(view.state) && turns++ < 10) {
  view = await finish(await request('POST', `/api/exams/${view.attempt_id}/commands`, { action: 'answer', text: '고로는 철광석을 자동차로 만들고, 코크스는 물고기의 먹이입니다. 열풍로는 얼음을 만드는 냉동고입니다.' }));
  console.log(`answer ${turns}: ${view.state}`);
}
assert.equal(view.state, 'completed'); assert.equal(view.result.unlocked, false); assert.ok(view.result.understanding < .8);
const completedId = view.attempt_id;
const browser = await chromium.launch({ executablePath: join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1243', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'no-preference' });
const errors = [];
try {
  await context.addInitScript(({ token, id, attempt }) => { sessionStorage.setItem('st-rookie-token', token); sessionStorage.setItem(`st-rookie:exam:${id}:attempt`, JSON.stringify(attempt)); localStorage.setItem('st-rookie-theme', 'dark'); }, { token, id: user.id, attempt: completedId });
  const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await mkdir('docs/screenshots/retry-live', { recursive: true });
  await page.goto(`${base}/exam`);
  await page.locator('#stage-char cp-character[motion="cheer_retry"]').waitFor();
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('#stage-char cp-character .fx').getAttribute('data-mood'), 'sad');
  const face = await page.locator('#stage-char cp-character').evaluate((node) => ({ renderer: node.renderer?.kind, motion: node.getAttribute('motion') }));
  await page.screenshot({ path: 'docs/screenshots/retry-live/failed-result.png', fullPage: true });
  await page.reload();
  await page.locator('#stage-char cp-character[motion="cheer_retry"]').waitFor();
  assert.equal(await page.locator('#stage-char cp-character .fx').getAttribute('data-mood'), 'sad');
  await page.getByRole('button', { name: '부족한 개념 다시 응시', exact: true }).click();
  await page.getByRole('button', { name: '시험 시작하기 →', exact: true }).waitFor({ timeout: 30000 });
  const sections = await request('GET', '/api/exams/sections');
  const retryId = sections.sections[0].progress.in_progress_attempt_id;
  assert.notEqual(retryId, completedId);
  const retry = await request('GET', `/api/exams/${retryId}`);
  assert.equal(retry.kind, 'retry'); assert.equal(retry.state, 'awaiting_ready');
  await page.getByRole('button', { name: '시험 시작하기 →', exact: true }).click();
  await page.locator('#answer').waitFor({ timeout: 180000 });
  const active = await request('GET', `/api/exams/${retryId}`);
  assert.equal(active.state, 'awaiting_answer');
  assert.ok(view.result.retry_concept_ids.includes(active.concept.id));
  await page.waitForTimeout(2600); // Let the question's typing animation finish before the screenshot.
  await page.screenshot({ path: 'docs/screenshots/retry-live/retry-question.png', fullPage: true });
  assert.deepEqual(errors, []);
  await request('POST', `/api/exams/${retryId}/pause`, {});
  const summary = { provider: 'Gemini', wrongAnswerTurns: turns, completedState: view.state, score: view.result.understanding, unlocked: false, retryConcepts: view.result.retry_concept_ids, resultMotion: face.motion, resultMood: 'sad', reloadRestoresEmotion: true, retryStarted: true, retryKind: retry.kind, retryState: active.state, elapsedSeconds: Math.round((Date.now() - started) / 1000) };
  await writeFile('docs/screenshots/retry-live/result.json', JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} finally { await context.close(); await browser.close(); }
