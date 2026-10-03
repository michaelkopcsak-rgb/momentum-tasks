// Microsoft: Outlook.com / Hotmail / Live and Microsoft 365 accounts through Microsoft Graph —
// Outlook Calendar (read-only), Microsoft To Do (read/write) and Outlook mail (send).
// Sign-in is OAuth 2.0 authorization code + PKCE in a pop-up; auth-callback.html hands the code back.
import { DAY, addDays, startOfDay } from '../dates.js';
import { CONFIG } from '../config.js';
import { dateOnlyToLocalDue, b64urlBytes, fetchJson } from './util.js';

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'openid profile offline_access User.Read Calendars.Read Tasks.ReadWrite Mail.Send';
const RT_KEY = 'momentum-tasks.ms-refresh';

let token = null;
let expiresAt = 0;
let pending = null; // cancels an in-flight sign-in

const redirectUri = () => new URL('auth-callback.html', location.origin + location.pathname).href;

const store = {
  get() { try { return sessionStorage.getItem(RT_KEY); } catch { return null; } },
  set(v) { try { if (v) sessionStorage.setItem(RT_KEY, v); else sessionStorage.removeItem(RT_KEY); } catch { /* ignore */ } },
};

async function tokenRequest(params) {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CONFIG.microsoftClientId, scope: SCOPES, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description?.split('\r\n')[0] || 'Microsoft sign-in failed.');
  token = data.access_token;
  expiresAt = Date.now() + (Number(data.expires_in) - 60) * 1000;
  // SPA refresh tokens last about a day; keep it for this tab only.
  if (data.refresh_token) store.set(data.refresh_token);
}

function waitForCallback(popup, expectedState) {
  return new Promise((resolve, reject) => {
    let done = false;
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('momentum-auth') : null;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      channel?.close();
      clearTimeout(timer);
      pending = null;
      fn(v);
    };
    const handle = (data) => {
      if (data?.type !== 'ms-auth') return;
      const p = new URLSearchParams(data.search);
      if (p.get('state') !== expectedState) return;
      if (p.get('error')) {
        const msg = p.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : (p.get('error_description') || 'Microsoft sign-in failed.');
        return finish(reject, new Error(msg));
      }
      finish(resolve, p.get('code'));
    };
    const onMessage = (e) => { if (e.origin === location.origin) handle(e.data); };
    window.addEventListener('message', onMessage);
    if (channel) channel.onmessage = (e) => handle(e.data);
    // Microsoft's login page can sever the link to the pop-up, so `popup.closed` isn't reliable;
    // the user can cancel from the app instead, and we give up after 5 minutes.
    const timer = setTimeout(() => finish(reject, new Error('Sign-in timed out. Please try again.')), 5 * 60 * 1000);
    pending = () => { try { popup?.close(); } catch { /* ignore */ } finish(reject, new Error('Sign-in was cancelled.')); };
  });
}

const api = (url, opts) => fetchJson(url, token, opts, () => { token = null; });

async function pages(url, opts) {
  const out = [];
  let next = url;
  while (next) {
    const data = await api(next, opts);
    out.push(...(data.value || []));
    next = data['@odata.nextLink'] || null;
  }
  return out;
}

const ymd = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const graphDate = (dt) => new Date(/Z|[+-]\d\d:\d\d$/.test(dt) ? dt : `${dt}Z`);

let defaultListId = null;

export const microsoft = {
  id: 'microsoft',
  name: 'Microsoft',
  oauth: true,
  taskSource: 'mstask',
  eventSource: 'mscal',
  canSendEmail: true,

  isConfigured: () => !!CONFIG.microsoftClientId,
  hasToken: () => !!token && Date.now() < expiresAt,
  canResumeSilently: () => !!store.get(),
  cancelSignIn: () => pending?.(),

  async signIn({ consent = false } = {}) {
    if (!CONFIG.microsoftClientId) throw new Error('Microsoft sign-in isn’t set up for this copy of the app yet.');
    const verifier = b64urlBytes(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64urlBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = b64urlBytes(crypto.getRandomValues(new Uint8Array(16)));
    const url = `${AUTHORITY}/authorize?${new URLSearchParams({
      client_id: CONFIG.microsoftClientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      response_mode: 'query',
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(consent ? { prompt: 'select_account' } : {}),
    })}`;
    const popup = window.open(url, 'momentum-ms-signin', 'width=520,height=700');
    if (!popup) throw new Error('Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.');
    const code = await waitForCallback(popup, state);
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier });
  },

  async ensureToken() {
    if (microsoft.hasToken()) return;
    const rt = store.get();
    if (rt) {
      try { await tokenRequest({ grant_type: 'refresh_token', refresh_token: rt }); return; } catch { store.set(null); }
    }
    await microsoft.signIn();
  },

  signOut() {
    token = null;
    expiresAt = 0;
    store.set(null);
  },

  async profile() {
    const me = await api(`${GRAPH}/me?$select=givenName,displayName,mail,userPrincipalName`);
    return { name: me.givenName || me.displayName || '', email: me.mail || me.userPrincipalName || '' };
  },

  async fetchTasks() {
    const lists = await pages(`${GRAPH}/me/todo/lists`);
    defaultListId = (lists.find((l) => l.wellknownListName === 'defaultList') || lists[0])?.id || null;
    const all = [];
    for (const list of lists) {
      const items = await pages(`${GRAPH}/me/todo/lists/${encodeURIComponent(list.id)}/tasks?$top=100`);
      for (const t of items) {
        if (!t.title?.trim()) continue;
        all.push({
          id: `mstask:${t.id}`, source: 'mstask', kind: 'task',
          remoteId: t.id, listId: list.id, listTitle: list.displayName,
          title: t.title.trim(),
          notes: (t.body?.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          due: t.dueDateTime ? dateOnlyToLocalDue(t.dueDateTime.dateTime.slice(0, 10)) : null, allDay: true,
          completedAt: t.status === 'completed'
            ? (t.completedDateTime ? graphDate(t.completedDateTime.dateTime).toISOString() : t.lastModifiedDateTime)
            : null,
          link: 'https://to-do.office.com/tasks/',
        });
      }
    }
    return all;
  },

  async fetchEvents() {
    const now = new Date();
    const params = new URLSearchParams({
      startDateTime: addDays(startOfDay(now), -7).toISOString(),
      endDateTime: new Date(now.getTime() + 30 * DAY).toISOString(),
      $top: '100',
      $select: 'id,subject,bodyPreview,start,end,isAllDay,isCancelled,webLink',
      $orderby: 'start/dateTime',
    });
    const events = await pages(`${GRAPH}/me/calendarView?${params}`, { headers: { Prefer: 'outlook.timezone="UTC"' } });
    return events.filter((e) => !e.isCancelled).map((e) => ({
      id: `mscal:${e.id}`, source: 'mscal', kind: 'event', remoteId: e.id,
      title: (e.subject || '(No title)').trim(),
      notes: (e.bodyPreview || '').trim(),
      // All-day end dates are exclusive midnight, so the event is due the day before.
      due: e.isAllDay ? dateOnlyToLocalDue(e.end.dateTime.slice(0, 10), -1) : graphDate(e.end.dateTime).toISOString(),
      allDay: !!e.isAllDay,
      link: e.webLink,
    }));
  },

  patchTask(t, changes) {
    const body = {};
    if ('completed' in changes) body.status = changes.completed ? 'completed' : 'notStarted';
    if ('due' in changes) body.dueDateTime = changes.due ? { dateTime: `${ymd(changes.due)}T00:00:00`, timeZone: 'UTC' } : null;
    return api(`${GRAPH}/me/todo/lists/${encodeURIComponent(t.listId)}/tasks/${encodeURIComponent(t.remoteId)}`, {
      method: 'PATCH', body: JSON.stringify(body),
    });
  },

  async createTask({ title, notes, due }) {
    if (!defaultListId) {
      const lists = await pages(`${GRAPH}/me/todo/lists`);
      defaultListId = (lists.find((l) => l.wellknownListName === 'defaultList') || lists[0])?.id;
    }
    const t = await api(`${GRAPH}/me/todo/lists/${encodeURIComponent(defaultListId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        ...(notes ? { body: { content: notes, contentType: 'text' } } : {}),
        ...(due ? { dueDateTime: { dateTime: `${ymd(due)}T00:00:00`, timeZone: 'UTC' } } : {}),
      }),
    });
    return { id: `mstask:${t.id}`, source: 'mstask', remoteId: t.id, listId: defaultListId, listTitle: 'Tasks', link: 'https://to-do.office.com/tasks/', allDay: true };
  },

  sendEmail(to, subject, text) {
    return api(`${GRAPH}/me/sendMail`, {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject: String(subject).replace(/[\r\n]+/g, ' '),
          body: { contentType: 'Text', content: text },
          toRecipients: [{ emailAddress: { address: String(to).trim() } }],
        },
        saveToSentItems: true,
      }),
    });
  },
};
