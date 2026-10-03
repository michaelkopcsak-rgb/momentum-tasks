// First-run flow: welcome → pick your provider → connect (sign in, or import a calendar file) → ready.
import { CHOICES, PROVIDERS } from './providers/index.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STEP_NUM = { welcome: 1, provider: 2, connect: 3, syncing: 3, done: 4 };
const TOTAL = 4;

// How to get an .ics file out of each provider that has no sign-in API.
const ICS_HELP = {
  yahoo: {
    why: 'Yahoo doesn’t let other apps sign in to your calendar, so you’ll bring it in as a calendar file. It takes about a minute.',
    steps: [
      'On a computer, open <b>calendar.yahoo.com</b>.',
      'Next to your calendar’s name, open its menu and choose <b>Share</b>.',
      'Copy the <b>ICS</b> link (the one for importing into other calendar apps), paste it into your browser’s address bar, and the <b>.ics</b> file downloads.',
      'Choose that file below.',
    ],
  },
  apple: {
    why: 'Apple doesn’t let web apps sign in to iCloud Calendar or Reminders, so you’ll bring your calendar in as a file. It takes about a minute.',
    steps: [
      'On a Mac, open the <b>Calendar</b> app and select the calendar you want in the sidebar.',
      'Choose <b>File → Export → Export…</b> and save the <b>.ics</b> file.',
      'No Mac? On <b>icloud.com/calendar</b>, share the calendar as a <b>Public Calendar</b>, open the link in your browser and save the file.',
      'Choose that file below.',
    ],
  },
  other: {
    why: 'Most calendar apps can export a calendar as an <b>.ics</b> file, which Momentum can read.',
    steps: [
      'In your calendar app’s settings, look for <b>Export</b>, <b>Share</b>, or a <b>secret address in iCal format</b>.',
      'Save the <b>.ics</b> file (open the link in your browser if you got a link).',
      'Choose that file below.',
    ],
  },
};

const ACCESS = {
  google: [
    ['event', 'See your Google Calendar events', 'Read-only. Momentum never changes your calendar.'],
    ['task_alt', 'See and update Google Tasks', 'Due dates and check-offs you make here sync back.'],
    ['forward_to_inbox', 'Send “task done” emails from your Gmail', 'Only to people you choose, only when you finish a task.'],
  ],
  microsoft: [
    ['event', 'See your Outlook calendar events', 'Read-only. Momentum never changes your calendar.'],
    ['task_alt', 'See and update Microsoft To Do tasks', 'Due dates and check-offs you make here sync back.'],
    ['forward_to_inbox', 'Send “task done” emails from your Outlook address', 'Only to people you choose, only when you finish a task.'],
  ],
};

function header(ob) {
  const n = STEP_NUM[ob.step];
  const canBack = ob.step === 'provider' || ob.step === 'connect';
  return `
    <div class="ob-header">
      ${canBack ? '<button class="icon-btn" data-action="ob-back" aria-label="Back"><span class="ms">arrow_back</span></button>' : '<span class="ob-spacer"></span>'}
      <div class="ob-progress">
        <span class="label-medium muted">Step ${n} of ${TOTAL}</span>
        <div class="progress" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="${TOTAL}" aria-valuenow="${n}"><span style="width:${(n / TOTAL) * 100}%"></span></div>
      </div>
      <span class="ob-spacer"></span>
    </div>`;
}

function errorBox(ob) {
  return `<div class="callout warn" role="alert" ${ob.error ? '' : 'hidden'}><span class="ms">error</span><span>${esc(ob.error || '')}</span></div>`;
}

function welcome() {
  return `
    <div class="logo"><span class="ms">local_fire_department</span></div>
    <h1 class="display-small" id="obHeading" tabindex="-1">Momentum Tasks</h1>
    <p class="body-large muted">All your tasks and calendar to-dos in one focused list, with a coach that tells you whether you’re gaining ground.</p>
    <ul class="features">
      <li class="feature"><span class="ms">checklist</span><span class="body-medium"><b>Every task in one place.</b> See what’s due, give undated tasks a date, and check things off.</span></li>
      <li class="feature"><span class="ms">forward_to_inbox</span><span class="body-medium"><b>Tell someone when it’s done.</b> Send them an email or a text the moment you finish.</span></li>
      <li class="feature"><span class="ms">trending_up</span><span class="body-medium"><b>Build momentum.</b> Streaks, levels and a weekly pace check, plus a focus list when you start to slip.</span></li>
    </ul>
    <div class="ob-actions">
      <button class="btn filled block" data-action="ob-start">Get started</button>
      <button class="btn text block" data-action="load-demo">Just exploring? Try it with sample data</button>
    </div>`;
}

function providerStep(ob) {
  return `
    <h1 class="headline-medium" id="obHeading" tabindex="-1">Where do you keep your email and calendar?</h1>
    <p class="body-large muted">Momentum pulls your tasks and events from there. You can switch later in Settings.</p>
    <ul class="choice-list" aria-label="Email and calendar providers">
      ${CHOICES.map((c) => `
        <li><button class="choice" data-action="ob-choose" data-value="${c.id}">
          <span class="mono mono-${c.id}" aria-hidden="true">${esc(c.mono)}</span>
          <span class="grow"><span class="title-medium">${esc(c.name)}</span><span class="body-medium muted">${esc(c.detail)}</span></span>
          <span class="ms">chevron_right</span>
        </button></li>`).join('')}
    </ul>
    <button class="btn text block" data-action="load-demo">Try it with sample data instead</button>`;
}

function connectOAuth(ob, choice) {
  const P = PROVIDERS[choice.provider];
  const configured = P.isConfigured();
  return `
    <span class="mono mono-${choice.id} mono-lg" aria-hidden="true">${esc(choice.mono)}</span>
    <h1 class="headline-medium" id="obHeading" tabindex="-1">Connect your ${esc(choice.name)} account</h1>
    <p class="body-large muted">${choice.id === 'microsoft' ? 'Works with Outlook.com, Hotmail, Live and work or school Microsoft 365 accounts.' : 'Works with any Gmail or Google Workspace account.'}</p>
    <div class="card stack">
      <h2 class="title-small">Momentum will be able to</h2>
      <ul class="access-list">
        ${ACCESS[choice.id].map(([icon, title, sub]) => `
          <li class="feature"><span class="ms">${icon}</span><span><span class="body-large" style="display:block">${title}</span><span class="body-medium muted">${sub}</span></span></li>`).join('')}
      </ul>
    </div>
    <div class="callout"><span class="ms">lock</span><span>You’ll sign in on ${esc(choice.name)}’s own page, so Momentum never sees your password. Your tasks stay in this browser and aren’t stored on any server.</span></div>
    ${configured ? '' : `<div class="callout warn" role="note"><span class="ms">build</span><span>${esc(choice.name)} sign-in isn’t set up for this copy of the app yet. Ask the person who shared it to add a ${esc(choice.name)} client ID (see the README), or pick another option.</span></div>`}
    ${errorBox(ob)}
    <div class="ob-actions">
      ${ob.busy
        ? `<button class="btn filled block" disabled aria-describedby="obWait"><span class="spinner" aria-hidden="true"></span>Waiting for ${esc(choice.name)}…</button>
           <p class="body-small muted" id="obWait" role="status">Finish signing in in the pop-up window.</p>
           <button class="btn text block" data-action="ob-cancel">Cancel</button>`
        : `<button class="btn filled block" data-action="ob-connect" ${configured ? '' : 'disabled'}>Continue with ${esc(choice.name)}</button>`}
    </div>`;
}

function connectIcs(ob, choice) {
  const help = ICS_HELP[choice.id];
  return `
    <span class="mono mono-${choice.id} mono-lg" aria-hidden="true">${esc(choice.mono)}</span>
    <h1 class="headline-medium" id="obHeading" tabindex="-1">Bring in your ${choice.id === 'other' ? 'calendar' : `${esc(choice.name)} calendar`}</h1>
    <p class="body-large muted">${help.why}</p>
    <div class="card">
      <ol class="steps body-medium">${help.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    </div>
    <div class="callout"><span class="ms">info</span><span>When you finish a task, completion emails open in your own email app, ready to send. To refresh, import a new file from Settings any time.</span></div>
    ${errorBox(ob)}
    <div class="ob-actions">
      <input type="file" id="icsFile" hidden accept=".ics,text/calendar" data-field="ics-file" />
      ${ob.busy
        ? '<button class="btn filled block" disabled><span class="spinner" aria-hidden="true"></span>Reading file…</button>'
        : '<button class="btn filled block" data-action="pick-ics" aria-describedby="icsHint"><span class="ms">upload_file</span>Choose .ics file</button>'}
      <p class="body-small muted" id="icsHint">Events from the past week and the next 30 days, plus any to-dos in the file, become tasks.</p>
    </div>`;
}

function syncing(ob, choice) {
  return `
    <div class="ob-center">
      <span class="spinner spinner-lg" aria-hidden="true"></span>
      <h1 class="headline-medium" id="obHeading" tabindex="-1">Bringing in your tasks…</h1>
      <ul class="sync-log body-medium" role="status" aria-live="polite">
        ${(ob.log || []).map((l) => `<li><span class="ms">check</span>${esc(l)}</li>`).join('')}
      </ul>
    </div>`;
}

function done(ob, ctx) {
  const r = ob.result || { tasks: 0, events: 0, undated: 0 };
  const name = ctx.account?.name ? `, ${esc(ctx.account.name)}` : '';
  const st = ctx.settings;
  return `
    <div class="logo success"><span class="ms">check</span></div>
    <h1 class="headline-medium" id="obHeading" tabindex="-1">You’re all set${name}!</h1>
    <p class="body-large muted">${ctx.account?.email ? `Connected to ${esc(ctx.account.email)}. ` : ''}Here’s what Momentum found:</p>
    <div class="grid3">
      <div class="card stat"><div class="value">${r.tasks}</div><div class="label-medium muted">open task${r.tasks === 1 ? '' : 's'}</div></div>
      <div class="card stat"><div class="value">${r.events}</div><div class="label-medium muted">upcoming event${r.events === 1 ? '' : 's'}</div></div>
      <div class="card stat"><div class="value">${r.undated}</div><div class="label-medium muted">need a due date</div></div>
    </div>
    <div class="card stack">
      <div>
        <h2 class="title-small">Who should hear when you finish things?</h2>
        <p class="body-medium muted" style="margin:4px 0 0">Optional. This becomes the default for new tasks, and you choose per task whether to notify.</p>
      </div>
      <div class="segmented" role="group" aria-label="Default way to notify">
        ${['email', 'sms'].map((ch) => `<button aria-pressed="${st.defaultChannel === ch}" data-action="default-channel" data-value="${ch}"><span class="ms">${ch === 'email' ? 'mail' : 'sms'}</span>${ch === 'email' ? 'Email' : 'Text'}</button>`).join('')}
      </div>
      <label class="field"><span>${st.defaultChannel === 'sms' ? 'Phone number' : 'Email address'} (optional)</span>
        <input data-field="defaultRecipient" value="${esc(st.defaultRecipient)}" type="${st.defaultChannel === 'sms' ? 'tel' : 'email'}" autocomplete="off" placeholder="${st.defaultChannel === 'sms' ? '+1 555 555 0123' : 'name@example.com'}" />
      </label>
    </div>
    <div class="ob-actions">
      <button class="btn filled block" data-action="ob-finish">Go to my tasks</button>
    </div>`;
}

export function renderOnboarding(ob, ctx) {
  const choice = CHOICES.find((c) => c.id === ob.choice);
  let body;
  if (ob.step === 'provider') body = providerStep(ob);
  else if (ob.step === 'connect') body = PROVIDERS[choice.provider].oauth ? connectOAuth(ob, choice) : connectIcs(ob, choice);
  else if (ob.step === 'syncing') body = syncing(ob, choice);
  else if (ob.step === 'done') body = done(ob, ctx);
  else body = welcome();
  return `${ob.step === 'welcome' ? '' : header(ob)}<div class="onboard">${body}</div>`;
}
