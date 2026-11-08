import { createApiClient } from '../3d-demo/api-client.js';

const api = createApiClient();
const $ = (id) => document.getElementById(id);
const el = (tag, className = '', text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (text, action, style = 'button') => { const node = el('button', style, text); node.type = 'button'; node.addEventListener('click', action); return node; };
const PHASES = { queued: '요청을 접수했어요. 앞선 평가가 끝나면 시작해요.', preparing: '평가 시험을 준비하고 있어요.', question: '개념을 확인할 문제를 준비하고 있어요.', grading: '답안의 핵심 개념을 평가하고 있어요.', explanation: '다시 살펴볼 개념을 정리하고 있어요.', recheck: '추가 확인 문제를 준비하고 있어요.' };
const state = { user: null, sections: [], view: null, activeJob: null, submission: null, draft: '', watching: false, pending: false };
const key = (suffix) => `st-rookie:exam:${state.user?.id}:${suffix}`;
const save = (suffix, value) => { try { if (value === null) sessionStorage.removeItem(key(suffix)); else sessionStorage.setItem(key(suffix), JSON.stringify(value)); } catch {} };
const read = (suffix) => { try { return JSON.parse(sessionStorage.getItem(key(suffix)) || 'null'); } catch { return null; } };
const copyError = (error) => (error?.message || '요청을 처리하지 못했어요.').replaceAll('이해도 확인', '평가 시험');
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function loading(on, job) {
  state.pending = on;
  if (job) state.activeJob = job;
  $('cancel-job').disabled = !state.activeJob;
  $('forge-phase').textContent = on ? (PHASES[state.activeJob?.phase] || '요청을 접수하고 있어요.') : '';
  if (on && !$('forge').open) $('forge').showModal();
  if (!on && $('forge').open) $('forge').close();
  if (!on) { state.activeJob = null; $('reconnect').hidden = true; }
}
setInterval(() => {
  const start = state.activeJob ? Date.parse(state.activeJob.created_at) : state.submission?.started;
  const seconds = start ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
  $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}, 1000);
async function refreshSections() { state.sections = (await api.request('GET', '/api/exams/sections')).sections; renderSections(); }
function renderSections() {
  $('sections').replaceChildren(...state.sections.map((s, i) => {
    const p = s.progress, active = state.view?.section === s.section;
    const card = el('article', `process-card${active ? ' active' : ''}${!s.checkpoint ? ' unavailable' : ''}`);
    const top = el('div', 'process-top');
    top.append(el('span', 'process-num', `0${i + 1}`), el('span', `badge${p?.unlocked ? ' accent' : ''}`,
      !s.checkpoint ? '준비 중' : p?.unlocked ? '통과' : p?.in_progress_attempt_id ? '응시 중' : p?.open ? '응시 가능' : '잠금'));
    const label = !s.checkpoint ? '시험 준비 중' : p?.unlocked ? '결과 보기' : p?.in_progress_attempt_id ? '이어서 응시' : '시험 응시';
    const action = button(label, async () => {
      notice();
      try {
        if (p?.in_progress_attempt_id) {
          await openAttempt(p.in_progress_attempt_id);
          if (state.view.state === 'paused') await send('resume');
        } else if (p?.unlocked) {
          if (s.last_attempt_id) return await openAttempt(s.last_attempt_id);
          const events = (await api.request('GET', '/api/me/exam-history')).events;
          const event = events.find((e) => e.view.section === s.section && e.view.state === 'completed');
          if (event) await openAttempt(event.attempt_id); else notice('이전에 통과한 시험이에요. 자세한 기록은 학습 기록에서 확인해 주세요.');
        } else await dispatch('/api/exams', { section: s.section });
      } catch (error) { notice(copyError(error)); }
    });
    action.disabled = !s.checkpoint || (!p?.open && !p?.unlocked) || state.pending;
    card.append(top, el('h2', '', s.name), el('p', 'micro', s.checkpoint ? `${s.concept_count}개 개념 · 자신의 말로 답하기` : '평가 기준을 준비하고 있어요'), action);
    return card;
  }));
}
async function openAttempt(id) {
  state.view = await api.request('GET', `/api/exams/${id}`);
  state.draft = read(`draft:${id}`) || '';
  save('attempt', id);
  renderExam(); renderSections();
}
function currentTurn(view) {
  const history = view.history || [];
  const lastUser = history.findLastIndex((m) => m.role === 'user');
  return history.length ? history.slice(lastUser + 1).filter((m) => m.role === 'tutor') : view.tutor || [];
}
function renderExam() {
  const view = state.view;
  if (!view) return;
  const root = $('exam-content'); root.replaceChildren();
  const name = state.sections.find((s) => s.section === view.section)?.name || '제선';
  const heading = el('div', 'exam-head'), title = el('div');
  title.append(el('p', 'eyebrow', 'ASSESSMENT'), el('h2', '', `${name} 평가 시험`));
  const progress = el('div', 'exam-progress');
  for (const p of view.progress || []) progress.append(el('span', p.status));
  title.append(progress);
  const phase = view.state === 'completed' ? '평가 완료' : view.state === 'awaiting_recheck' ? '추가 확인' : view.state === 'paused' ? '일시 중지' : view.state === 'error' ? '재평가 필요' : view.state === 'awaiting_ready' ? '응시 준비' : `${view.concept?.index || 1} / ${view.concept?.total || 1} 개념`;
  heading.append(title, el('span', 'badge accent', phase)); root.append(heading);
  if (view.state === 'completed') {
    renderResult(root, view.result);
  } else {
    const turn = currentTurn(view);
    for (const message of turn.filter((m) => ['explanation', 'feedback', 'key_points', 'error'].includes(m.type))) root.append(el('div', 'explanation', message.text));
    const question = [...turn].reverse().find((m) => ['question', 'recheck_question', 'intro'].includes(m.type));
    root.append(el('p', 'question-label', view.state === 'awaiting_recheck' ? 'ADDITIONAL QUESTION' : 'YOUR NEXT STEP'));
    root.append(el('p', 'question-text', view.state === 'paused' ? '잠시 멈춘 시험을 이어서 진행할 수 있어요.' : question?.text || (view.state === 'error' ? '채점을 완료하지 못했어요. 입력한 답안을 다시 평가해 주세요.' : '문제에 답해 주세요.')));
    if (view.state === 'awaiting_ready') root.append(button('시험 시작하기 →', () => send('answer', '준비됐어요.')));
    else if (view.state === 'paused') root.append(button('시험 이어서 진행 →', () => send('resume')));
    else if (view.state === 'error') root.append(button('같은 답안 다시 평가', () => send('retry-evaluation')));
    else if (['awaiting_answer', 'awaiting_recheck'].includes(view.state)) {
      const form = el('form', 'answer-form'), label = el('label', '', '나의 답안'); label.htmlFor = 'answer';
      const area = el('textarea'); area.id = 'answer'; area.maxLength = 1000; area.rows = 5; area.value = state.draft;
      area.placeholder = '공정과 물질의 역할을 생각하며 자신의 말로 설명해 주세요.';
      const bottom = el('div', 'form-bottom'), counter = el('span', 'micro', `${area.value.length} / 1000`), submit = button('답안 제출 →', () => {});
      submit.type = 'submit'; submit.disabled = !area.value.trim();
      area.addEventListener('input', () => { state.draft = area.value; save(`draft:${view.attempt_id}`, area.value); counter.textContent = `${area.value.length} / 1000`; submit.disabled = !area.value.trim(); });
      form.addEventListener('submit', (event) => { event.preventDefault(); if (area.value.trim()) void send('answer', area.value.trim()); });
      bottom.append(counter, submit); form.append(label, area, bottom); root.append(form);
    }
    if (['awaiting_ready', 'awaiting_answer', 'awaiting_recheck', 'error'].includes(view.state)) {
      const tools = el('div', 'exam-tools'); tools.append(button('잠시 멈추고 학습하기', () => leave('/login'), 'button ghost')); root.append(tools);
    }
  }
  if (view.history?.length) {
    const details = el('details'); details.append(el('summary', '', '이번 시험의 전체 대화 보기'));
    for (const m of view.history) details.append(el('p', 'transcript', `${m.role === 'user' ? '나의 답안' : '평가 안내'} · ${m.text}`));
    root.append(details);
  }
}
function renderResult(root, result) {
  const score = Math.round(result.understanding * 100), head = el('div', 'result-head'), ring = el('div', 'score-ring');
  // Numeric values come from the server's deterministic scoring, not the LLM's text.
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 140 140');
  for (const progress of [false, true]) {
    const circle = document.createElementNS(ns, 'circle');
    for (const [attr, value] of Object.entries({ cx: 70, cy: 70, r: 59, fill: 'none', stroke: progress ? 'var(--accent)' : 'var(--line)', 'stroke-width': 6 })) circle.setAttribute(attr, String(value));
    if (progress) { circle.setAttribute('stroke-dasharray', `${result.understanding * 371} 371`); circle.setAttribute('stroke-linecap', 'round'); }
    svg.append(circle);
  }
  const number = el('span', 'score-number', String(score)); number.append(el('small', '', '%')); ring.append(svg, number);
  const title = el('div'); title.append(el('span', 'badge accent', result.unlocked ? '통과' : '다시 도전'), el('h2', '', '평가를 완료했어요'), el('p', 'muted', result.unlocked ? '개념을 확인했어요. 다음 공정으로 나아가세요.' : '아직 어려운 개념을 복습한 뒤 다시 도전해 보세요.'));
  head.append(ring, title); root.append(head);
  for (const concept of result.concepts) {
    const row = el('div', 'concept-result'), bar = el('div', 'result-bar'), fill = el('span'); fill.style.width = `${concept.score * 100}%`; bar.append(fill);
    row.append(el('strong', '', concept.name), bar, el('span', 'micro', concept.score === 1 ? '정답' : concept.score === .5 ? '부분 정답' : '복습 필요')); root.append(row);
  }
  const tools = el('div', 'exam-tools'); tools.append(button('학습 기록으로 돌아가기', () => leave('/login')));
  if (!result.unlocked) tools.append(button('부족한 개념 다시 응시', () => dispatch('/api/exams', { section: state.view.section }), 'button secondary'));
  root.append(tools);
}
async function dispatch(path, body, existing) {
  if (state.pending && !existing) return;
  notice();
  const submission = existing || { path, body, key: crypto.randomUUID(), started: Date.now() };
  state.submission = submission; save('submission', submission); loading(true); renderSections();
  try {
    const job = await api.request('POST', path, body, { idempotencyKey: submission.key });
    save('job', job.id); save('submission', null); loading(true, job);
    await watch(job.id);
  } catch (error) {
    if (error.status === 0) {
      $('forge-phase').textContent = '네트워크 연결이 끊겼어요. 같은 요청을 안전하게 다시 확인할 수 있어요.';
      $('reconnect').hidden = false;
    } else { save('submission', null); loading(false); notice(copyError(error)); renderSections(); }
  }
}
async function send(action, text) {
  if (state.pending || !state.view) return;
  await dispatch(`/api/exams/${state.view.attempt_id}/commands`, { action, ...(text === undefined ? {} : { text }) });
}
async function watch(id) {
  if (state.watching) return;
  state.watching = true;
  loading(true);
  try {
    for (;;) {
      const job = await api.request('GET', `/api/exam-jobs/${id}`); loading(true, job);
      if (job.state === 'succeeded') {
        save('job', null); loading(false); state.draft = ''; save(`draft:${job.result.attempt_id}`, null);
        await openAttempt(job.result.attempt_id); await refreshSections(); await refreshAside(); break;
      }
      if (job.state === 'failed' || job.state === 'cancelled') {
        save('job', null); loading(false); notice(job.state === 'cancelled' ? '요청을 취소했어요. 입력한 답안은 그대로 남아 있어요.' : copyError(job.error));
        if (state.view?.attempt_id) await openAttempt(state.view.attempt_id);
        await refreshSections(); break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    if (error.status === 401) { loading(false); notice('로그인이 만료됐어요. 다시 로그인해 주세요.'); }
    else { $('forge-phase').textContent = '서버 연결을 확인해 주세요. 처리 기록은 남아 있어요.'; $('reconnect').hidden = false; }
  } finally { state.watching = false; }
}
async function cancel() {
  if (!state.activeJob) return;
  try { await api.request('DELETE', `/api/exam-jobs/${state.activeJob.id}`); }
  catch (error) { $('forge-phase').textContent = copyError(error); $('reconnect').hidden = false; }
}
async function refreshAside() {
  const results = await Promise.allSettled([api.request('GET', '/api/me/reviews'), api.request('GET', '/api/me/assignments'), api.request('GET', '/api/me/exam-history')]);
  const [reviews, assignments, history] = results.map((r) => r.status === 'fulfilled' ? r.value : null);
  if (reviews) {
    const tasks = reviews.tasks.filter((t) => !t.completed); $('review-count').textContent = `${tasks.length}개`;
    $('reviews').replaceChildren(...(tasks.length ? tasks.slice(0, 5).map((task) => {
      const item = el('div', 'list-item'); item.append(el('h3', '', task.concept_name), el('p', 'micro', `${task.due ? '오늘 복습' : task.due_date} · ${task.reason}`), button('복습 완료', async () => {
        try { await api.request('POST', `/api/me/reviews/${task.id}/complete`, {}); await refreshAside(); } catch (error) { notice(copyError(error)); }
      }, 'small-button')); return item;
    }) : [el('p', 'muted', '평가를 마치면 1·3·7일 기준으로 복습 일정을 정해요.')]));
  }
  if (assignments) $('assignments').replaceChildren(...(assignments.assignments.length ? assignments.assignments.slice(0, 5).map((a) => {
    const item = el('div', 'list-item'); item.append(el('h3', '', a.title), el('p', 'micro', `${a.group_name} · ${a.due_date}까지`), el('span', 'micro', a.status === 'completed' ? '완료' : a.status === 'overdue' ? '마감 지남' : '응시 대기')); return item;
  }) : [el('p', 'muted', '아직 배정된 시험이 없어요.')]));
  if (history) {
    const seen = new Set(), completed = history.events.filter((e) => { if (e.view.state !== 'completed' || seen.has(e.attempt_id)) return false; seen.add(e.attempt_id); return true; });
    $('history').replaceChildren(...(completed.length ? completed.slice(0, 4).map((event) => {
      const item = el('div', 'list-item'), name = state.sections.find((s) => s.section === event.view.section)?.name || event.view.section;
      item.append(el('h3', '', `${name} · ${Math.round(event.view.result.understanding * 100)}%`), el('p', 'micro', new Date(event.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })), button('결과 보기', () => openAttempt(event.attempt_id), 'small-button')); return item;
    }) : [el('p', 'muted', '완료한 시험의 기준과 결과를 함께 기록해요.')]));
  }
}
async function leave(url) {
  if (state.pending) return notice('처리 중인 요청을 먼저 취소해 주세요.');
  if (state.view && ['awaiting_ready', 'awaiting_answer', 'awaiting_recheck', 'error'].includes(state.view.state)) {
    try { await api.request('POST', `/api/exams/${state.view.attempt_id}/pause`, {}); } catch (error) { return notice(copyError(error)); }
  }
  location.assign(url);
}
function theme(value) {
  document.body.dataset.theme = value; $('theme').textContent = value === 'dark' ? '☀' : '☾';
  try { localStorage.setItem('st-rookie-theme', value); } catch {}
}
$('theme').addEventListener('click', () => theme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
document.querySelectorAll('[data-leave]').forEach((node) => node.addEventListener('click', (event) => { event.preventDefault(); void leave(node.getAttribute('href')); }));
$('cancel-job').addEventListener('click', cancel);
$('forge').addEventListener('cancel', (event) => { event.preventDefault(); void cancel(); });
$('reconnect').addEventListener('click', () => {
  $('reconnect').hidden = true;
  const id = read('job'), submission = read('submission');
  if (id) void watch(id); else if (submission) void dispatch(submission.path, submission.body, submission); else loading(false);
});
$('logout').addEventListener('click', async () => {
  if (state.pending) return notice('처리 중인 요청을 먼저 취소해 주세요.');
  if (state.view && ['awaiting_ready', 'awaiting_answer', 'awaiting_recheck', 'error'].includes(state.view.state)) {
    try { await api.request('POST', `/api/exams/${state.view.attempt_id}/pause`, {}); } catch (error) { return notice(copyError(error)); }
  }
  localStorage.removeItem('st-rookie-token'); sessionStorage.removeItem('st-rookie-token'); location.assign('/login_ui/home-sleek.html');
});
async function boot() {
  let storedTheme = 'dark'; try { storedTheme = localStorage.getItem('st-rookie-theme') || 'dark'; } catch {} theme(storedTheme);
  if (!api.hasToken()) return location.replace('/login_ui/home-sleek.html?next=exam');
  try {
    state.user = (await api.request('GET', '/api/auth/me')).user; $('profile').textContent = `${state.user.name} · 내 시험`;
    await refreshSections(); await refreshAside();
    const jobId = read('job'), submission = read('submission'), attempt = read('attempt');
    if (attempt) { try { await openAttempt(attempt); } catch { save('attempt', null); } }
    if (jobId) await watch(jobId); else if (submission) await dispatch(submission.path, submission.body, submission);
  } catch (error) {
    if (error.status === 401) location.replace('/login_ui/home-sleek.html?next=exam'); else notice(copyError(error));
  }
}
void boot();
