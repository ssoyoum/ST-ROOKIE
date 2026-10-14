// Optional local browser QA. Run only against a separate QA database/server.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '../data/browser-tools/node_modules/playwright/index.mjs';

const base = process.env.DEMO_QA_URL || 'http://127.0.0.1:3012';
const browser = await chromium.launch({ executablePath: join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1243', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
const errors = [], chatCalls = [];
try {
  const stamp = Date.now();
  const signup = await context.request.post(`${base}/api/auth/signup`, { data: { username: `layout_${stamp}`, password: `layout-${stamp}`, name: '화면 검증', employee_no: `QA${stamp}` } });
  assert.equal(signup.status(), 201);
  const { token } = await signup.json();
  const status = await (await context.request.get(`${base}/api/status`)).json();
  assert.equal(status.provider, 'Gemini');
  await context.addInitScript((auth) => { sessionStorage.setItem('st-rookie-token', auth); localStorage.setItem('st-rookie-theme', 'dark'); }, token);
  await mkdir('docs/screenshots/demo-fixes', { recursive: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/chat') chatCalls.push(r.url()); });
  await page.goto(`${base}/3d-demo/steel-index.html?p=ironmaking&tutor=1`);
  await page.locator('#bar .stop').first().waitFor({ timeout: 90000 });
  assert.equal(await page.locator('#btnTutor, #chatInput').count(), 0);
  await page.locator('#bar .stop').nth(1).click();
  await page.locator('#right.on .panel-head').waitFor();
  for (const size of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const boxes = await page.evaluate(() => Object.fromEntries(['top', 'bar', 'right'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, { x: r.x, right: r.right, y: r.y, bottom: r.bottom }]; })));
    for (const box of Object.values(boxes)) { assert.ok(box.x >= -1 && box.right <= size.width + 1); assert.ok(box.y >= 0 && box.bottom <= size.height); }
    assert.ok(boxes.right.bottom <= boxes.bar.y);
    await page.screenshot({ path: `docs/screenshots/demo-fixes/process-${size.width}.png` });
  }
  assert.equal(chatCalls.length, 0, 'process page creates no chat requests');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: '마이페이지에서 질문', exact: true }).click();
  await page.waitForURL(/My%20Page/);
  const query = new URL(page.url()).searchParams;
  const trainee = page.frameLocator('iframe[title="신입사원 학습 현황"]');
  await trainee.locator('#tutorInput').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  assert.equal(await trainee.locator('process-2d').getAttribute('process'), query.get('p'));
  assert.equal(await trainee.locator('process-2d').getAttribute('selected'), query.get('equipment'));
  for (const size of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    const input = await trainee.locator('#tutorInput').boundingBox();
    assert.ok(input && input.y >= 0 && input.y + input.height <= size.height, 'composer stays visible on laptop');
    await page.screenshot({ path: `docs/screenshots/demo-fixes/mypage-${size.width}.png` });
  }
  await trainee.locator('#tutorInput').fill('고로에서 코크스가 하는 역할을 두 문장으로 설명해 주세요.');
  const responsePromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/chat' && r.request().method() === 'POST', { timeout: 180000 });
  await trainee.getByRole('button', { name: '보내기', exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const text = await response.text();
  assert.match(text, /환원|열원|일산화탄소/);
  await trainee.locator('#tutorInput:enabled').waitFor();
  await page.screenshot({ path: 'docs/screenshots/demo-fixes/mypage-gemini.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await trainee.locator('#tutorInput').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/demo-fixes/mypage-mobile.png' });
  assert.equal(await trainee.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  // Explicit completed-result fixtures check expression and transition without altering grades.
  let passed = false;
  const view = () => ({ attempt_id: 'visual-result', section: 'ironmaking', kind: 'first', state: 'completed', concept: null, tutor: [], progress: [], history: [],
    result: { understanding: passed ? 1 : .33, unlocked: passed, threshold: .8, retry_concept_ids: passed ? [] : ['coke'], concepts: [{ concept_id: 'coke', name: '코크스', score: passed ? 1 : 0, final_verdict: passed ? 'correct' : 'wrong' }] } });
  await page.route('**/api/exams/visual-result', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view()) }));
  await page.goto(`${base}/exam`);
  await page.waitForFunction(() => document.querySelector('#profile').textContent.includes('화면'));
  const user = await (await context.request.get(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  await page.evaluate((id) => sessionStorage.setItem(`st-rookie:exam:${id}:attempt`, JSON.stringify('visual-result')), user.user.id);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.reload();
  await page.locator('#stage-char cp-character[motion="cheer_retry"]').waitFor();
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('#stage-char cp-character .fx').getAttribute('data-mood'), 'sad');
  await page.screenshot({ path: 'docs/screenshots/demo-fixes/exam-retry.png', fullPage: true });
  passed = true; await page.reload();
  await page.locator('#stage-char cp-character[motion="celebrate"]').waitFor();
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('#stage-char cp-character .fx').getAttribute('data-mood'), 'celebrate');
  await page.screenshot({ path: 'docs/screenshots/demo-fixes/exam-pass.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Gemini real response, process controls/no chat, My Page context/composer, mobile and retry/pass expressions passed.');
} finally { await context.close(); await browser.close(); }
