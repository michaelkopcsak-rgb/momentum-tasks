import { load, save, clear, defaultState, effDue, isOpen, isOverdue } from './store.js';
import {
  startOfWeek, addDays, sameDay, diffDays, toDateInput, toTimeInput, fromInputs,
  fmtTime, fmtDayLabel, fmtShort,
} from './dates.js';
import { computeStats, statusCopy, onTime } from './momentum.js';
import { PROVIDERS, CHOICES, SOURCE } from './providers/index.js';
import { renderOnboarding } from './onboarding.js';
import { demoTasks } from './demo.js';

let state = load();
let view = location.hash.slice(1) || 'tasks';
let filter = 'all';
let sheet = null; // { mode: 'edit', id } | { mode: 'new', draft }
let sheetReturnFocus = null;
let snackTimer = null;
let ob = { step: 'welcome', choice: null, error: '', busy: false, log: [], result: null };

PROVIDERS.google.setClientIdOverride(state.settings.clientId);

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Icon ligatures ("checklist", "sync") would be read aloud by screen readers, so every icon is hidden from them.
const a11y = (html) => html.replace(/<span class="ms(?=[\s"])([^"]*)"(?![^>]*aria-hidden)/g, '<span class="ms$1" aria-hidden="true"');
const persist = () => save(state);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const effAllDay = (t) => (t.dueLocal ? !!t.dueLocalAllDay : t.allDay !== false);
const tasksArr = () => Object.values(state.tasks);
const defaultNotify = () => ({ enabled: false, channel: state.settings.defaultChannel, to: state.settings.defaultRecipient });
const P = () => (state.mode === 'live' && state.provider ? PROVIDERS[state.provider] : null);
const live = () => !!P()?.oauth;
// Events and imported items are read-only at the source, so date changes are kept in the app.
const localOverride = (t) => t.kind === 'event' || t.source === 'ics';
const syncsRemote = (t) => live() && t.source === P().taskSource && !!t.remoteId;
const TITLES = { tasks: 'Tasks', history: 'History', momentum: 'Momentum', settings: 'Settings' };

/* ---------- Rendering ---------- */

function render() {
  renderMain();
  renderSheet();
}

function renderMain() {
  const onboarding = !state.onboarded;
  document.body.classList.toggle('onboarding', onboarding);
  $('.top-bar').hidden = onboarding;
  $('.nav-bar').hidden = onboarding;
  $('#fab').hidden = onboarding || view !== 'tasks';
  document.body.classList.toggle('has-fab', !$('#fab').hidden);
  $('#syncBtn').hidden = !live();
  $('#title').textContent = TITLES[view] || 'Tasks';
  document.title = onboarding ? 'Welcome · Momentum Tasks' : `${TITLES[view] || 'Tasks'} · Momentum Tasks`;
  document.querySelectorAll('.nav-bar button').forEach((b) => {
    if (b.dataset.nav === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const main = $('#view');
  let html;
  if (onboarding) html = renderOnboarding(ob, { account: state.account, settings: state.settings });
  else if (view === 'history') html = renderHistory();
  else if (view === 'momentum') html = renderMomentum();
  else if (view === 'settings') html = renderSettings();
  else html = renderTasks();
  main.innerHTML = a11y(html);
}

function dueMeta(t, now) {
  if (t.completedAt) return `<span>Done ${esc(fmtDayLabel(t.completedAt, now))} · ${esc(fmtTime(t.completedAt))}</span>`;
  const d = effDue(t);
  if (!d) return '<span class="add-due"><span class="ms">calendar_add_on</span>Add due date</span>';
  const overdue = isOverdue(t, now);
  const cls = overdue ? 'due-overdue' : sameDay(d, now) ? 'due-today' : '';
  const time = effAllDay(t) ? '' : ` · ${fmtTime(d)}`;
  return `<span class="${cls}">${overdue ? 'Overdue · ' : 'Due '}${esc(fmtDayLabel(d, now))}${esc(time)}</span>`;
}

function taskRow(t, now) {
  const src = SOURCE[t.source] || SOURCE.local;
  const notify = t.notify?.enabled
    ? `<span class="ms sm">${t.notify.channel === 'sms' ? 'sms' : 'forward_to_inbox'}</span><span class="sr-only">. Notifies ${esc(t.notify.to)}</span>`
    : '';
  // The checkbox and the "open details" button are siblings, never nested.
  return `
    <div class="item ${t.completedAt ? 'done' : ''}">
      <button class="check" role="checkbox" aria-checked="${!!t.completedAt}" aria-label="${esc(t.title)}" data-action="toggle" data-id="${esc(t.id)}">
        <span class="box"><span class="ms">check</span></span>
      </button>
      <button class="content" data-action="open" data-id="${esc(t.id)}">
        <span class="headline">${esc(t.title)}<span class="sr-only">, details</span></span>
        <span class="meta"><span class="ms">${t.kind === 'task' && t.source === 'ics' ? 'task_alt' : src.icon}</span><span class="sr-only">${src.label}. </span>${dueMeta(t, now)}${notify ? `<span class="trail">${notify}</span>` : ''}</span>
      </button>
    </div>`;
}

function miniMomentum(s) {
  const c = statusCopy(s);
  return `
    <a class="mini tone-${s.status}" href="#momentum">
      <span class="ms fill">${c.icon}</span>
      <span class="grow">
        <span class="title-small" style="display:block">${esc(c.headline)}</span>
        <span class="body-small">${s.thisWeek} this week · ${s.lastWeekToDate} by now last week${s.streak ? ` · ${s.streak}-day streak` : ''}</span>
      </span>
      <span class="label-medium">Level ${s.level}</span>
    </a>`;
}

function renderTasks() {
  const now = new Date();
  const s = computeStats(state.tasks, now);
  const open = tasksArr().filter(isOpen);
  const g = { overdue: [], today: [], upcoming: [], nodate: [] };
  for (const t of open) {
    const d = effDue(t);
    if (!d) g.nodate.push(t);
    else if (new Date(d) < now) g.overdue.push(t);
    else if (sameDay(d, now)) g.today.push(t);
    else g.upcoming.push(t);
  }
  const byDue = (a, b) => new Date(effDue(a)) - new Date(effDue(b));
  g.overdue.sort(byDue); g.today.sort(byDue); g.upcoming.sort(byDue);
  g.nodate.sort((a, b) => a.title.localeCompare(b.title));
  const doneToday = tasksArr().filter((t) => t.completedAt && sameDay(t.completedAt, now))
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const chips = [
    ['all', 'All', open.length],
    ['today', 'Today', g.today.length],
    ['overdue', 'Overdue', g.overdue.length],
    ['upcoming', 'Upcoming', g.upcoming.length],
    ['nodate', 'No date', g.nodate.length],
  ].map(([id, label, n]) => `
    <button class="chip" aria-pressed="${filter === id}" data-action="filter" data-value="${id}">
      ${filter === id ? '<span class="ms">check</span>' : ''}${label}<span class="count"><span class="sr-only">, </span>${n}</span>
    </button>`).join('');

  const sections = [
    ['overdue', 'Overdue', 'error'],
    ['today', 'Due today', ''],
    ['upcoming', 'Upcoming', ''],
    ['nodate', 'No due date', ''],
  ].filter(([id]) => (filter === 'all' || filter === id) && g[id].length)
    .map(([id, label, cls]) => `
      <h2 class="section-label title-small ${cls}">${label}<span class="label-medium"><span class="sr-only">, </span>${g[id].length}</span></h2>
      <div class="list" role="list">${g[id].map((t) => `<div role="listitem">${taskRow(t, now)}</div>`).join('')}</div>`).join('');

  const empty = !sections ? `
    <div class="empty">
      <span class="ms">${open.length ? 'filter_alt_off' : 'celebration'}</span>
      <p class="title-medium">${open.length ? 'Nothing in this view' : 'All clear!'}</p>
      <p class="body-medium muted">${open.length ? 'Try another filter.' : live() ? 'Sync to pull in new tasks, or add one with the New task button.' : 'Add a task with the New task button.'}</p>
    </div>` : '';

  const doneSection = doneToday.length && filter === 'all' ? `
    <h2 class="section-label title-small">Completed today<span class="label-medium"><span class="sr-only">, </span>${doneToday.length}</span></h2>
    <div class="list" role="list">${doneToday.map((t) => `<div role="listitem">${taskRow(t, now)}</div>`).join('')}</div>` : '';

  return `${miniMomentum(s)}<div class="chips" role="group" aria-label="Filter tasks">${chips}</div>${sections}${empty}${doneSection}`;
}

function histItem(t, now, withDay) {
  const late = !onTime(t);
  const src = SOURCE[t.source] || SOURCE.local;
  return `
    <li class="hist-item">
      <span class="ms">check_circle</span>
      <div class="t">
        <div class="body-large clip">${esc(t.title)}</div>
        <div class="body-small muted">${withDay ? `${esc(fmtDayLabel(t.completedAt, now))} · ` : ''}${esc(fmtTime(t.completedAt))}${late ? ' · <span class="due-overdue">Late</span>' : ''}${t.notify?.sentAt ? ' · Notified' : ''}<span class="sr-only"> · ${src.label}</span></div>
      </div>
      <span class="ms sm src-icon">${src.icon}</span>
    </li>`;
}

const histList = (items, now, withDay) => `<ul class="hist-list">${items.map((t) => histItem(t, now, withDay)).join('')}</ul>`;

function renderHistory() {
  const now = new Date();
  const done = tasksArr().filter((t) => t.completedAt).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  if (!done.length) {
    return `<div class="empty"><span class="ms">history</span><p class="title-medium">No completed tasks yet</p>
      <p class="body-medium muted">Everything you finish shows up here by day, week and month.</p></div>`;
  }
  const ws = startOfWeek(now);
  const todayIdx = diffDays(now, ws);
  const inRange = (from, to) => done.filter((t) => { const c = new Date(t.completedAt); return c >= from && c < to; });

  let html = `<h2 class="section-label title-small">This week<span class="label-medium">${inRange(ws, addDays(ws, 7)).length} done</span></h2>`;
  for (let d = todayIdx; d >= 0; d--) {
    const day = addDays(ws, d);
    const items = inRange(day, addDays(day, 1));
    const isToday = d === todayIdx;
    html += `
      <details class="group" ${items.length ? 'open' : ''}>
        <summary>
          <span class="day-dot ${items.length ? 'has' : ''} ${isToday ? 'today' : ''}" aria-hidden="true">${day.getDate()}</span>
          <span class="grow"><span class="title-medium" style="display:block">${isToday ? 'Today' : day.toLocaleDateString([], { weekday: 'long' })}</span>
          <span class="body-small muted">${day.toLocaleDateString([], { month: 'long', day: 'numeric' })}</span></span>
          ${items.length ? `<span class="count-pill">${items.length}<span class="sr-only"> done</span></span>` : '<span class="body-small muted">None</span>'}
          <span class="ms chev">expand_more</span>
        </summary>
        ${items.length ? histList(items, now, false) : `<p class="empty-day body-small muted">${isToday ? 'Nothing yet today. Your next check-off lands here.' : 'Nothing completed.'}</p>`}
      </details>`;
  }

  html += '<h2 class="section-label title-small">Previous weeks</h2>';
  for (let i = 1; i <= 4; i++) {
    const from = addDays(ws, -7 * i);
    const items = inRange(from, addDays(from, 7));
    html += `
      <details class="group">
        <summary>
          <span class="day-dot ${items.length ? 'has' : ''}"><span class="ms sm">date_range</span></span>
          <span class="grow"><span class="title-medium" style="display:block">${i === 1 ? 'Last week' : `${i} weeks ago`}</span>
          <span class="body-small muted">${esc(fmtShort(from))} – ${esc(fmtShort(addDays(from, 6)))}</span></span>
          <span class="count-pill">${items.length}<span class="sr-only"> done</span></span>
          <span class="ms chev">expand_more</span>
        </summary>
        ${items.length ? histList(items, now, true) : '<p class="empty-day body-small muted">Nothing completed.</p>'}
      </details>`;
  }

  const older = done.filter((t) => new Date(t.completedAt) < addDays(ws, -28));
  if (older.length) {
    const months = new Map();
    for (const t of older) {
      const c = new Date(t.completedAt);
      const key = `${c.getFullYear()}-${c.getMonth()}`;
      if (!months.has(key)) months.set(key, { label: c.toLocaleDateString([], { month: 'long', year: 'numeric' }), items: [] });
      months.get(key).items.push(t);
    }
    html += '<h2 class="section-label title-small">Earlier months</h2>';
    for (const m of months.values()) {
      html += `
        <details class="group">
          <summary>
            <span class="day-dot has"><span class="ms sm">calendar_month</span></span>
            <span class="grow title-medium">${esc(m.label)}</span>
            <span class="count-pill">${m.items.length}<span class="sr-only"> done</span></span>
            <span class="ms chev">expand_more</span>
          </summary>
          ${histList(m.items, now, true)}
        </details>`;
    }
  }
  return html;
}

function delta(cur, prev, fmt = (x) => x) {
  if (prev === null || cur === null || prev === undefined) return '';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '<span class="delta muted"><span class="ms">trending_flat</span>Same as last week</span>';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}"><span class="ms">${d > 0 ? 'arrow_upward' : 'arrow_downward'}</span>${d > 0 ? 'Up' : 'Down'} ${fmt(Math.abs(d))} vs last week</span>`;
}

function renderMomentum() {
  const now = new Date();
  const s = computeStats(state.tasks, now);
  const c = statusCopy(s);
  const pct = (r) => (r === null ? '–' : `${Math.round(r * 100)}%`);
  const max = Math.max(1, ...s.weeks.map((w) => w.count), s.projected);

  const focus = s.status !== 'rising' && s.focus.length ? `
    <section aria-labelledby="focusHeading">
      <h2 class="section-label title-small" id="focusHeading">Your focus list<span class="label-medium">Do these first</span></h2>
      <div class="list" role="list">${s.focus.map((t) => `<div role="listitem">${taskRow(t, now)}</div>`).join('')}</div>
    </section>` : '';

  const bars = s.weeks.map((w) => {
    const h = (w.count / max) * 100;
    const ghost = w.current && s.projected > w.count ? `<div class="bar ghost" style="height:${(s.projected / max) * 100}%"></div>` : '';
    return `
      <div class="bar-col">
        <span class="bar-num">${w.count}</span>
        <div class="bar-wrap">${ghost}<div class="bar ${w.current ? 'current' : ''}" style="height:${h}%"></div></div>
        <span class="bar-label">${w.current ? 'Now' : esc(fmtShort(w.start))}</span>
      </div>`;
  }).join('');
  const chartLabel = `Tasks completed per week, oldest first: ${s.weeks.map((w) => `${w.current ? 'this week so far' : `week of ${fmtShort(w.start)}`} ${w.count}`).join(', ')}. On pace for ${s.projected} this week.`;

  return `
    <div class="stack">
      <section class="hero tone-${s.status}" aria-labelledby="heroHeading">
        <div class="row">
          <span class="badge-icon"><span class="ms">${c.icon}</span></span>
          <h2 class="headline-small" id="heroHeading">${esc(c.headline)}</h2>
        </div>
        <p class="body-medium" style="margin:0">${esc(c.body)}</p>
      </section>
      ${focus}
      <h2 class="sr-only">Your stats</h2>
      <div class="grid2">
        <div class="card stat">
          <h3 class="label-medium muted">This week</h3>
          <div class="value">${s.thisWeek}</div>
          ${delta(s.thisWeek, s.lastWeekToDate)}
        </div>
        <div class="card stat">
          <h3 class="label-medium muted">On-time rate</h3>
          <div class="value">${pct(s.rateThis)}</div>
          ${delta(s.rateThis, s.rateLast, (x) => `${Math.round(x * 100)} pts`)}
        </div>
        <div class="card stat">
          <h3 class="label-medium muted">Streak</h3>
          <div class="value">${s.streak} <span class="body-medium muted">day${s.streak === 1 ? '' : 's'}</span></div>
          <span class="delta muted">${s.doneToday || !s.streak ? `Best: ${s.bestStreak}` : 'Finish one today to keep it'}</span>
        </div>
        <div class="card stat">
          <h3 class="label-medium muted">Level ${s.level}</h3>
          <div class="value" style="font-size:22px">${esc(s.levelName)}</div>
          <div class="progress" role="progressbar" aria-label="Progress to level ${s.level + 1}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.levelProgress * 100)}" style="margin:6px 0 4px"><span style="width:${Math.round(s.levelProgress * 100)}%"></span></div>
          <span class="delta muted">${s.xpToNext} XP to next level</span>
        </div>
      </div>
      <section class="card" aria-labelledby="chartHeading">
        <h2 class="title-small" id="chartHeading">Tasks completed per week</h2>
        <p class="body-small muted" style="margin:0">Dashed bar shows where this week’s pace is heading (${s.projected})</p>
        <div class="chart" role="img" aria-label="${esc(chartLabel)}">${bars}</div>
      </section>
      <section aria-labelledby="msHeading">
        <h2 class="section-label title-small" id="msHeading">Milestones<span class="label-medium">${s.milestones.filter((m) => m.earned).length} of ${s.milestones.length} earned</span></h2>
        <ul class="badges">${s.milestones.map((m) => `
          <li class="badge ${m.earned ? 'earned' : ''}"><span class="ms">${m.earned ? m.icon : 'lock'}</span><span class="label-medium">${esc(m.name)}</span><span class="sr-only">${m.earned ? ', earned' : ', not earned yet'}</span></li>`).join('')}
        </ul>
      </section>
      <div class="callout"><span class="ms">info</span><span>Momentum compares what you’ve finished so far this week with the same point last week, and tracks how many tasks you finish by their due date. +10 XP per task, +5 more when it’s on time.</span></div>
    </div>`;
}

function renderSettings() {
  const st = state.settings;
  const Pr = P();
  const choice = CHOICES.find((c) => c.id === state.choice);
  let account;
  if (state.mode === 'demo') {
    account = `
      <div class="feature"><span class="ms">science</span><div>
        <div class="title-medium">Using sample data</div>
        <div class="body-medium muted">Connect your own email and calendar to manage your real tasks.</div>
      </div></div>
      <div><button class="btn filled" data-action="restart-onboarding"><span class="ms">link</span>Connect my account</button></div>`;
  } else if (Pr?.oauth) {
    account = `
      <div class="feature"><span class="ms">verified_user</span><div>
        <div class="title-medium">${esc(choice?.name || Pr.name)}${state.account?.email ? ` · ${esc(state.account.email)}` : ''}</div>
        <div class="body-medium muted">${state.lastSync ? `Last synced ${esc(fmtDayLabel(state.lastSync, new Date()))} at ${esc(fmtTime(state.lastSync))}` : 'Not synced yet'}</div>
      </div></div>
      <div class="sheet-actions"><button class="btn filled" data-action="sync"><span class="ms">sync</span>Sync now</button>
      <button class="btn text" data-action="restart-onboarding">Switch account</button></div>`;
  } else {
    account = `
      <div class="feature"><span class="ms">event_note</span><div>
        <div class="title-medium">${esc(choice?.name || 'Calendar file')} calendar file</div>
        <div class="body-medium muted">${state.lastSync ? `Imported ${esc(fmtDayLabel(state.lastSync, new Date()))} at ${esc(fmtTime(state.lastSync))}` : 'Not imported yet'}</div>
      </div></div>
      <input type="file" id="icsFile" hidden accept=".ics,text/calendar" data-field="ics-file" />
      <div class="sheet-actions"><button class="btn filled" data-action="pick-ics"><span class="ms">upload_file</span>Import a newer file</button>
      <button class="btn text" data-action="restart-onboarding">Switch provider</button></div>`;
  }

  return `
    <div class="stack">
      <h2 class="section-label title-small">Account</h2>
      <div class="card stack">${account}</div>

      ${Pr?.oauth ? `
      <h2 class="section-label title-small">Sources</h2>
      <div class="card">
        <div class="switch-row">
          <div class="grow"><div class="body-large" id="evLabel">Include calendar events</div>
          <div class="body-medium muted" id="evDesc">Treat events from the past week and next 30 days as tasks. Your task lists are always included.</div></div>
          <button class="switch" role="switch" aria-checked="${st.includeEvents}" aria-labelledby="evLabel" aria-describedby="evDesc" data-action="toggle-events"></button>
        </div>
      </div>` : ''}

      <h2 class="section-label title-small">Completion notices</h2>
      <div class="card stack">
        <p class="body-medium muted" style="margin:0">Defaults for new tasks. You can change who gets notified on any task.</p>
        <div class="segmented" role="group" aria-label="Default way to notify">
          ${['email', 'sms'].map((ch) => `<button aria-pressed="${st.defaultChannel === ch}" data-action="default-channel" data-value="${ch}"><span class="ms">${ch === 'email' ? 'mail' : 'sms'}</span>${ch === 'email' ? 'Email' : 'Text'}</button>`).join('')}
        </div>
        <label class="field"><span>Default ${st.defaultChannel === 'sms' ? 'phone number' : 'email address'}</span>
          <input data-field="defaultRecipient" value="${esc(st.defaultRecipient)}" placeholder="${st.defaultChannel === 'sms' ? '+1 555 555 0123' : 'name@example.com'}" type="${st.defaultChannel === 'sms' ? 'tel' : 'email'}" />
        </label>
      </div>

      <h2 class="section-label title-small">Data</h2>
      <div class="card stack">
        <p class="body-medium muted" style="margin:0">Your tasks and history are stored only in this browser.</p>
        <div class="sheet-actions"><button class="btn outlined danger" data-action="clear-all">Sign out and clear data</button></div>
      </div>
    </div>`;
}

/* ---------- Task sheet (modal dialog) ---------- */

function renderSheet() {
  const el = $('#sheet');
  const scrim = $('#scrim');
  const t = sheet?.mode === 'edit' ? state.tasks[sheet.id] : sheet?.draft;
  if (!sheet || !t) { el.hidden = true; scrim.hidden = true; el.innerHTML = ''; setInert(false); return; }
  const isNew = sheet.mode === 'new';
  const src = SOURCE[t.source] || SOURCE.local;
  const editableTitle = isNew || t.source === 'local';
  const remoteTaskSource = live() ? P().taskSource : null;
  const showTime = !(t.source === 'gtask' || t.source === 'mstask' || (isNew && remoteTaskSource));
  const due = effDue(t);
  const n = t.notify || defaultNotify();
  const canAutoEmail = live() && P().canSendEmail;
  const clearLabel = !due ? '' : !isNew && localOverride(t) ? (t.dueLocal ? 'Reset to original date' : '') : 'Remove due date';
  const sourceLabel = isNew ? (remoteTaskSource ? `New task in ${SOURCE[remoteTaskSource].label}` : 'New task') : (t.listTitle || src.label);

  el.innerHTML = a11y(`
    <div class="handle" aria-hidden="true"></div>
    <div class="stack">
      <div class="sheet-top">
        <span class="src-tag"><span class="ms">${isNew ? 'add_task' : src.icon}</span>${esc(sourceLabel)}</span>
        <button class="icon-btn" data-action="close-sheet" aria-label="Close"><span class="ms">close</span></button>
      </div>
      <h2 class="${editableTitle ? 'sr-only' : 'headline-small'}" id="sheetHeading" tabindex="-1">${isNew ? 'New task' : esc(t.title)}</h2>
      ${editableTitle ? `<label class="field"><span>Title</span><input id="sheetTitle" data-field="title" value="${esc(t.title)}" placeholder="What needs doing?" required aria-required="true" /></label>` : ''}
      ${editableTitle
        ? `<label class="field"><span>Notes</span><textarea data-field="notes" rows="2" placeholder="Optional">${esc(t.notes)}</textarea></label>`
        : t.notes ? `<p class="body-medium muted" style="margin:0">${esc(t.notes.slice(0, 400))}</p>` : ''}

      <fieldset class="plain">
        <legend class="title-small">Due date</legend>
        <div class="field-row" style="${showTime ? '' : 'grid-template-columns:1fr'}">
          <label class="field"><span>Date</span><input type="date" data-field="due-date" value="${toDateInput(due)}" /></label>
          ${showTime ? `<label class="field"><span>Time (optional)</span><input type="time" data-field="due-time" value="${due && !effAllDay(t) ? toTimeInput(due) : ''}" /></label>` : ''}
        </div>
      </fieldset>
      ${!isNew && localOverride(t) ? `<p class="body-small muted" style="margin:0">${t.dueLocal ? 'Custom due date, saved in Momentum only. ' : t.kind === 'event' ? 'Due when the event ends. ' : ''}${t.source === 'ics' ? 'The imported file isn’t changed.' : 'Your calendar isn’t changed.'}</p>` : ''}
      ${!isNew && syncsRemote(t) ? `<p class="body-small muted" style="margin:0">Changes sync to ${SOURCE[t.source].label}, which stores dates only.</p>` : ''}
      ${clearLabel ? `<div><button class="btn text" data-action="clear-due" style="margin-left:-12px">${clearLabel}</button></div>` : ''}

      <div class="divider" role="presentation"></div>

      <div class="switch-row">
        <div class="grow"><div class="body-large" id="notifyLabel">Notify someone when done</div>
        <div class="body-medium muted" id="notifyDesc">${n.enabled && n.to ? `${n.channel === 'sms' ? 'Text' : 'Email'} ${esc(n.to)}` : 'Send a quick “it’s done” message'}</div></div>
        <button class="switch" role="switch" aria-checked="${!!n.enabled}" aria-labelledby="notifyLabel" aria-describedby="notifyDesc" data-action="notify-toggle"></button>
      </div>
      ${n.enabled ? `
        <div class="segmented" role="group" aria-label="Notify by">
          ${['email', 'sms'].map((ch) => `<button aria-pressed="${n.channel === ch}" data-action="channel" data-value="${ch}"><span class="ms">${ch === 'email' ? 'mail' : 'sms'}</span>${ch === 'email' ? 'Email' : 'Text'}</button>`).join('')}
        </div>
        <label class="field">
          <span>${n.channel === 'sms' ? 'Phone number' : 'Email address'}</span>
          <input data-field="notify-to" type="${n.channel === 'sms' ? 'tel' : 'email'}" value="${esc(n.to)}" placeholder="${n.channel === 'sms' ? '+1 555 555 0123' : 'name@example.com'}" autocomplete="off" aria-describedby="notifyHelp" />
          <span class="support" id="notifyHelp">${n.channel === 'sms'
            ? 'Opens your messaging app with the text ready to send.'
            : canAutoEmail ? `Sent automatically from your ${esc(P().name)} account the moment you check this off.` : 'Opens an email in your mail app, ready to send.'}</span>
        </label>` : ''}

      <div class="divider" role="presentation"></div>

      <div class="sheet-actions">
        ${isNew
          ? '<button class="btn filled" data-action="create"><span class="ms">add</span>Add task</button>'
          : t.completedAt
            ? `<button class="btn tonal" data-action="toggle" data-id="${esc(t.id)}" style="flex:1"><span class="ms">undo</span>Mark not done</button>`
            : `<button class="btn filled" data-action="toggle" data-id="${esc(t.id)}"><span class="ms">check</span>Mark complete</button>`}
        ${!isNew && t.link ? `<a class="btn text" href="${esc(t.link)}" target="_blank" rel="noopener"><span class="ms">open_in_new</span>Open<span class="sr-only"> in ${esc(src.label)} (new tab)</span></a>` : ''}
        ${!isNew && t.kind === 'event' && !t.completedAt ? '<button class="btn text" data-action="dismiss">Not a task</button>' : ''}
        ${!isNew && t.source === 'local' ? '<button class="btn text danger" data-action="delete">Delete</button>' : ''}
      </div>
    </div>`);
  el.setAttribute('aria-labelledby', 'sheetHeading');
  el.hidden = false;
  scrim.hidden = false;
  setInert(true);
}

// While the dialog is open, everything behind it is unreachable by keyboard and screen readers.
function setInert(on) {
  for (const el of [$('.app'), $('#snackbar')]) {
    if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
  }
}

function openSheet(next) {
  const wasOpen = !!sheet;
  if (!wasOpen) sheetReturnFocus = document.activeElement;
  sheet = next;
  renderSheet();
  if (!wasOpen) setTimeout(() => ($('#sheetTitle') || $('#sheetHeading'))?.focus({ preventScroll: true }), 50);
}

function closeSheet({ restoreFocus = true } = {}) {
  if (!sheet) return;
  sheet = null;
  renderSheet();
  const target = sheetReturnFocus;
  sheetReturnFocus = null;
  if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
  else if (restoreFocus) $('#view').focus({ preventScroll: true });
}

const sheetTask = () => (sheet?.mode === 'edit' ? state.tasks[sheet.id] : sheet?.draft);

/* ---------- Actions ---------- */

function snack(msg, action) {
  const el = $('#snackbar');
  clearTimeout(snackTimer);
  el.innerHTML = `<span class="msg">${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.fn(); };
  el.hidden = false;
  startSnackTimer(action ? 8000 : 5000);
}

function startSnackTimer(ms) {
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { $('#snackbar').hidden = true; }, ms);
}

async function remote(fn) {
  try {
    await P().ensureToken();
    return await fn(P());
  } catch (e) {
    snack(e.message);
    return null;
  }
}

async function sendCompletionNotice(t) {
  const n = t.notify;
  if (!n?.enabled || !n.to?.trim()) return null;
  const to = n.to.trim();
  const when = new Date(t.completedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  if (state.mode === 'demo') return `Sample data: would ${n.channel === 'sms' ? 'text' : 'email'} ${to}`;
  if (n.channel === 'sms') {
    const phone = to.replace(/[^\d+]/g, '');
    const sep = /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? '&' : '?';
    location.href = `sms:${phone}${sep}body=${encodeURIComponent(`Done: ${t.title} (${when})`)}`;
    return `Opening Messages to text ${to}`;
  }
  const subject = `Done: ${t.title}`;
  const body = `Hi,\n\n"${t.title}" was marked complete on ${when}.\n\nSent from Momentum Tasks`;
  const Pr = P();
  if (Pr?.canSendEmail && Pr.hasToken()) {
    try {
      await Pr.sendEmail(to, subject, body);
      t.notify.sentAt = new Date().toISOString();
      persist();
      return `Emailed ${to}`;
    } catch (e) {
      return `Couldn’t email ${to}: ${e.message}`;
    }
  }
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `Opened an email to ${to}`;
}

async function toggleComplete(id, btn) {
  const t = state.tasks[id];
  if (!t) return;
  const before = computeStats(state.tasks);
  const completing = !t.completedAt;
  t.completedAt = completing ? new Date().toISOString() : null;
  persist();

  if (btn) { btn.setAttribute('aria-checked', String(completing)); btn.classList.add('pop'); }
  setTimeout(() => {
    // Keep keyboard users in place: the row moves, so focus the next task's checkbox.
    const hadFocus = btn && document.activeElement === btn;
    const ids = [...document.querySelectorAll('#view .check')].map((b) => b.dataset.id);
    const nextId = ids[ids.indexOf(id) + 1];
    renderMain();
    if (hadFocus) {
      const target = [...document.querySelectorAll('#view .check')].find((b) => b.dataset.id === nextId) || $('#view .check') || $('#view');
      target.focus({ preventScroll: true });
    }
  }, btn ? 380 : 0);

  if (syncsRemote(t)) remote((Pr) => Pr.patchTask(t, { completed: completing }));
  if (!completing) { snack(`Marked “${t.title}” not done`); return; }

  const after = computeStats(state.tasks);
  const notice = await sendCompletionNotice(t);
  let msg = `Completed “${t.title}”. +${onTime(t) ? 15 : 10} XP`;
  if (after.level > before.level) msg = `Level up! You’re now Level ${after.level}: ${after.levelName}`;
  else if (after.status === 'rising' && before.status !== 'rising') msg = 'You’re building momentum again!';
  else if (after.thisWeek === after.lastWeekToDate + 1 && before.thisWeek === before.lastWeekToDate) msg = 'You just pulled ahead of last week';
  if (notice) msg += ` · ${notice}`;
  snack(msg, {
    label: 'Undo',
    fn: () => {
      t.completedAt = null;
      persist();
      render();
      if (syncsRemote(t)) remote((Pr) => Pr.patchTask(t, { completed: false }));
    },
  });
}

function setDue(t, due, allDay) {
  if (sheet?.mode === 'new') { t.due = due; t.allDay = allDay; return; }
  if (localOverride(t)) {
    t.dueLocal = due;
    t.dueLocalAllDay = allDay;
  } else {
    t.due = due;
    t.allDay = allDay;
    if (syncsRemote(t)) remote((Pr) => Pr.patchTask(t, { due }));
  }
  persist();
  renderMain();
}

async function createTask() {
  const d = sheet.draft;
  const title = d.title.trim();
  if (!title) {
    snack('Give the task a title');
    const input = $('#sheetTitle');
    input?.setAttribute('aria-invalid', 'true');
    input?.focus();
    return;
  }
  let t = { ...d, id: `local:${uid()}`, source: 'local', kind: 'local', title, completedAt: null };
  if (live()) {
    const r = await remote((Pr) => Pr.createTask({ title, notes: d.notes, due: d.due }));
    if (r) t = { ...t, ...r, kind: 'task' };
  }
  state.tasks[t.id] = t;
  persist();
  closeSheet();
  if (filter !== 'all') filter = 'all';
  render();
  snack(t.source === 'local' ? 'Task added' : `Added to ${SOURCE[t.source].label}`);
}

function merge(remoteItems, source, kind) {
  const next = {};
  const seen = new Set(remoteItems.map((r) => r.id));
  for (const t of tasksArr()) {
    const sameFeed = t.source === source && (!kind || t.kind === kind);
    // Keep other feeds, and keep finished items that fell out of the sync window so history survives.
    if (!sameFeed || (t.completedAt && !seen.has(t.id))) next[t.id] = t;
  }
  for (const r of remoteItems) {
    const old = state.tasks[r.id];
    const appOwnsCompletion = r.kind === 'event' || r.source === 'ics';
    if (!old) { next[r.id] = { notify: defaultNotify(), ...r, completedAt: appOwnsCompletion ? (r.completedAt || null) : r.completedAt }; continue; }
    next[r.id] = {
      ...old, ...r,
      notify: old.notify, hidden: old.hidden, dueLocal: old.dueLocal, dueLocalAllDay: old.dueLocalAllDay,
      completedAt: appOwnsCompletion ? (old.completedAt || r.completedAt || null) : r.completedAt ? (old.completedAt || r.completedAt) : null,
    };
  }
  state.tasks = next;
}

const summarize = () => {
  const open = tasksArr().filter(isOpen);
  return {
    tasks: open.filter((t) => t.kind !== 'event').length,
    events: open.filter((t) => t.kind === 'event').length,
    undated: open.filter((t) => !effDue(t)).length,
  };
};

async function sync({ quiet = false, onStep } = {}) {
  const Pr = P();
  if (!Pr?.oauth) return null;
  const btn = $('#syncBtn');
  btn.classList.add('spinning');
  btn.setAttribute('aria-label', 'Syncing…');
  try {
    await Pr.ensureToken();
    const tasks = await Pr.fetchTasks();
    onStep?.(`Found ${tasks.filter((t) => !t.completedAt).length} open tasks in ${SOURCE[Pr.taskSource].label}`);
    const events = state.settings.includeEvents ? await Pr.fetchEvents() : [];
    if (state.settings.includeEvents) onStep?.(`Found ${events.length} events in ${SOURCE[Pr.eventSource].label}`);
    merge(tasks, Pr.taskSource);
    if (state.settings.includeEvents) merge(events, Pr.eventSource);
    else for (const t of tasksArr()) if (t.source === Pr.eventSource && !t.completedAt) delete state.tasks[t.id];
    state.lastSync = new Date().toISOString();
    persist();
    if (!quiet) {
      render();
      snack(`Synced ${tasks.filter((t) => !t.completedAt).length} open tasks${state.settings.includeEvents ? ` and ${events.length} events` : ''}`);
    }
    return true;
  } catch (e) {
    if (quiet) throw e;
    snack(e.message);
    return null;
  } finally {
    btn.classList.remove('spinning');
    btn.setAttribute('aria-label', 'Sync');
  }
}

async function importIcs(file) {
  const items = await PROVIDERS.ics.readFile(file);
  merge(items, 'ics');
  state.lastSync = new Date().toISOString();
  persist();
  return items;
}

/* ---------- Onboarding ---------- */

function obGo(patch, { focus = true } = {}) {
  ob = { ...ob, ...patch };
  renderMain();
  if (focus) {
    window.scrollTo({ top: 0 });
    $('#obHeading')?.focus({ preventScroll: true });
  }
}

async function obConnect() {
  const choice = CHOICES.find((c) => c.id === ob.choice);
  const Pr = PROVIDERS[choice.provider];
  obGo({ busy: true, error: '' }, { focus: false });
  try {
    await Pr.signIn({ consent: true });
  } catch (e) {
    obGo({ busy: false, error: e.message }, { focus: false });
    $('[data-action="ob-connect"]')?.focus();
    return;
  }
  // Signed in: start fresh for this account.
  state = { ...defaultState(), settings: { ...state.settings }, mode: 'live', provider: Pr.id, choice: choice.id };
  obGo({ step: 'syncing', busy: false, log: [] });
  const step = (line) => { ob.log = [...ob.log, line]; renderMain(); };
  try {
    state.account = await Pr.profile();
    step(`Signed in as ${state.account.email || state.account.name}`);
    await sync({ quiet: true, onStep: step });
    obGo({ step: 'done', result: summarize() });
  } catch (e) {
    state = { ...defaultState(), settings: { ...state.settings } };
    obGo({ step: 'connect', error: `Signed in, but couldn’t load your tasks: ${e.message}` });
  }
}

async function obImport(file) {
  const choice = CHOICES.find((c) => c.id === ob.choice);
  obGo({ busy: true, error: '' }, { focus: false });
  try {
    state = { ...defaultState(), settings: { ...state.settings }, mode: 'live', provider: 'ics', choice: choice.id };
    const items = await importIcs(file);
    obGo({ step: 'done', busy: false, result: summarize(), log: [`Imported ${items.length} items from ${file.name}`] });
  } catch (e) {
    state = { ...defaultState(), settings: { ...state.settings } };
    obGo({ busy: false, error: e.message }, { focus: false });
    $('[data-action="pick-ics"]')?.focus();
  }
}

function finishOnboarding() {
  state.onboarded = true;
  persist();
  filter = 'all';
  view = 'tasks';
  if (location.hash !== '#tasks') history.replaceState(null, '', '#tasks');
  render();
  window.scrollTo({ top: 0 });
  $('#title').focus({ preventScroll: true });
}

function restartOnboarding() {
  if (state.mode === 'live' && !confirm('Switch accounts? This signs you out and clears the tasks and history stored in this browser.')) return;
  P()?.signOut?.();
  state = { ...defaultState(), settings: { ...state.settings } };
  persist();
  ob = { step: 'provider', choice: null, error: '', busy: false, log: [], result: null };
  render();
  window.scrollTo({ top: 0 });
  $('#obHeading')?.focus();
}

/* ---------- Navigation ---------- */

function navigate(v) {
  if (location.hash.slice(1) === v) { view = v; render(); }
  else location.hash = v;
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => {
  view = location.hash.slice(1) || 'tasks';
  closeSheet({ restoreFocus: false });
  render();
  window.scrollTo({ top: 0 });
  // Move focus to the new screen's heading so screen reader users hear where they are.
  if (state.onboarded) $('#title').focus({ preventScroll: true });
});

/* ---------- Events ---------- */

document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-nav]');
  if (navEl) { navigate(navEl.dataset.nav); return; }
  const a = e.target.closest('[data-action]');
  if (!a || a.disabled) return;
  const { action, id, value } = a.dataset;
  const t = sheetTask();

  switch (action) {
    case 'toggle': {
      const fromSheet = !a.classList.contains('check');
      toggleComplete(id, fromSheet ? null : a);
      if (fromSheet) closeSheet();
      break;
    }
    case 'open': openSheet({ mode: 'edit', id }); break;
    case 'filter':
      filter = value;
      renderMain();
      $(`[data-action="filter"][data-value="${value}"]`)?.focus();
      break;
    case 'new-task': openSheet({ mode: 'new', draft: { title: '', notes: '', due: null, allDay: true, notify: defaultNotify(), source: 'local', kind: 'local' } }); break;
    case 'close-sheet': closeSheet(); break;
    case 'create': createTask(); break;
    case 'clear-due':
      if (localOverride(t) && sheet.mode === 'edit') { t.dueLocal = null; t.dueLocalAllDay = null; persist(); renderMain(); }
      else setDue(t, null, true);
      renderSheet();
      $('[data-field="due-date"]')?.focus();
      break;
    case 'notify-toggle':
      t.notify = { ...(t.notify || defaultNotify()) };
      t.notify.enabled = !t.notify.enabled;
      persist();
      if (sheet.mode === 'edit') renderMain();
      renderSheet();
      $(t.notify.enabled ? '[data-field="notify-to"]' : '[data-action="notify-toggle"]')?.focus();
      break;
    case 'channel':
      t.notify.channel = value;
      persist();
      if (sheet.mode === 'edit') renderMain();
      renderSheet();
      $(`[data-action="channel"][data-value="${value}"]`)?.focus();
      break;
    case 'dismiss': {
      const hiddenId = sheet.id;
      state.tasks[hiddenId].hidden = true; persist(); closeSheet({ restoreFocus: false }); render();
      $('#title').focus({ preventScroll: true });
      snack('Hidden from your list', { label: 'Undo', fn: () => { state.tasks[hiddenId].hidden = false; persist(); render(); } });
      break;
    }
    case 'delete': {
      const removed = state.tasks[sheet.id];
      delete state.tasks[sheet.id]; persist(); closeSheet({ restoreFocus: false }); render();
      $('#title').focus({ preventScroll: true });
      snack('Task deleted', { label: 'Undo', fn: () => { state.tasks[removed.id] = removed; persist(); render(); } });
      break;
    }
    case 'sync': sync(); break;
    case 'pick-ics': $('#icsFile')?.click(); break;
    case 'load-demo':
      state = { ...defaultState(), settings: { ...state.settings }, onboarded: true, mode: 'demo', tasks: demoTasks() };
      persist(); filter = 'all'; navigate('tasks');
      $('#title').focus({ preventScroll: true });
      snack('Sample data loaded. Check off a few tasks and watch your momentum change.');
      break;
    case 'toggle-events':
      state.settings.includeEvents = !state.settings.includeEvents; persist(); renderMain();
      $('[data-action="toggle-events"]')?.focus();
      if (live()) sync();
      break;
    case 'default-channel':
      state.settings.defaultChannel = value; persist(); renderMain();
      $(`[data-action="default-channel"][data-value="${value}"]`)?.focus();
      break;
    case 'restart-onboarding': restartOnboarding(); break;
    case 'clear-all':
      if (!confirm('Sign out and clear all tasks and history stored in this browser?')) return;
      P()?.signOut?.(); clear(); state = defaultState(); filter = 'all';
      ob = { step: 'welcome', choice: null, error: '', busy: false, log: [], result: null };
      navigate('tasks');
      $('#obHeading')?.focus({ preventScroll: true });
      break;
    // Onboarding
    case 'ob-start': obGo({ step: 'provider', error: '' }); break;
    case 'ob-choose': obGo({ step: 'connect', choice: value, error: '' }); break;
    case 'ob-back': obGo({ step: ob.step === 'connect' ? 'provider' : 'welcome', error: '', busy: false }); break;
    case 'ob-connect': obConnect(); break;
    case 'ob-cancel':
      PROVIDERS[CHOICES.find((c) => c.id === ob.choice).provider].cancelSignIn?.();
      obGo({ busy: false }, { focus: false });
      $('[data-action="ob-connect"]')?.focus();
      break;
    case 'ob-finish': finishOnboarding(); break;
  }
});

document.addEventListener('change', async (e) => {
  const f = e.target.dataset?.field;
  if (!f) return;
  const v = e.target.value;
  if (f === 'defaultRecipient') { state.settings.defaultRecipient = v.trim(); persist(); return; }
  if (f === 'ics-file') {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!state.onboarded) { obImport(file); return; }
    try {
      const items = await importIcs(file);
      render();
      snack(`Imported ${items.length} items from ${file.name}`);
    } catch (err) { snack(err.message); }
    return;
  }
  const t = sheetTask();
  if (!t) return;
  if (f === 'due-date' || f === 'due-time') {
    const date = $('[data-field="due-date"]').value;
    const time = $('[data-field="due-time"]')?.value || '';
    const { due, allDay } = fromInputs(date, time);
    setDue(t, due, allDay);
    renderSheet();
    $(`[data-field="${f}"]`)?.focus();
  } else if (f === 'notify-to') {
    t.notify.to = v.trim();
    persist();
    if (sheet.mode === 'edit') renderMain();
  } else if (f === 'title' || f === 'notes') {
    t[f] = f === 'title' ? v.trim() || t.title : v;
    if (sheet.mode === 'edit') { persist(); renderMain(); }
  }
});

// Keep drafts current while typing so re-renders don't lose input.
document.addEventListener('input', (e) => {
  const f = e.target.dataset?.field;
  if (sheet?.mode === 'new' && (f === 'title' || f === 'notes')) {
    sheet.draft[f] = e.target.value;
    if (f === 'title') e.target.removeAttribute('aria-invalid');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheet) { e.preventDefault(); closeSheet(); return; }
  if (e.key === 'Enter' && sheet?.mode === 'new' && e.target.dataset?.field === 'title') createTask();
  // Keep Tab inside the open dialog.
  if (e.key === 'Tab' && sheet) {
    const focusables = [...$('#sheet').querySelectorAll('button:not([disabled]), a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')];
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || !$('#sheet').contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// Don't let the snackbar disappear while someone is reading it or reaching for Undo.
const snackEl = $('#snackbar');
snackEl.addEventListener('mouseenter', () => clearTimeout(snackTimer));
snackEl.addEventListener('focusin', () => clearTimeout(snackTimer));
snackEl.addEventListener('mouseleave', () => startSnackTimer(4000));
snackEl.addEventListener('focusout', () => startSnackTimer(4000));

window.addEventListener('scroll', () => {
  $('.top-bar').classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

// Re-render when the tab comes back or a minute passes, so "today" and "overdue" stay right.
// Skip it while someone is focused inside the content, so their place isn't lost.
const idle = () => !sheet && !document.hidden && state.onboarded && !$('#view').contains(document.activeElement);
document.addEventListener('visibilitychange', () => { if (idle()) renderMain(); });
setInterval(() => { if (idle()) renderMain(); }, 60_000);

render();
// Microsoft keeps a refresh token for this tab, so a reload can sync without a pop-up.
if (state.onboarded && P()?.canResumeSilently()) sync();
