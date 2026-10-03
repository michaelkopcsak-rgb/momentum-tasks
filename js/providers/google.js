// Google: Calendar (read-only), Google Tasks (read/write) and Gmail (send),
// called from the browser with a short-lived token from Google Identity Services.
import { DAY, addDays, startOfDay } from '../dates.js';
import { CONFIG } from '../config.js';
import { dateOnlyToLocalDue, b64urlText, fetchJson } from './util.js';

const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

let token = null;
let expiresAt = 0;
let gisPromise = null;
let clientIdOverride = '';

const clientId = () => CONFIG.googleClientId || clientIdOverride;

function loadGis() {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

const api = (url, opts) => fetchJson(url, token, opts, () => { token = null; });

async function pages(url, key) {
  const out = [];
  let pageToken = '';
  do {
    const sep = url.includes('?') ? '&' : '?';
    const data = await api(url + (pageToken ? `${sep}pageToken=${encodeURIComponent(pageToken)}` : ''));
    out.push(...(data[key] || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

const dueField = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00.000Z`;
};

export const google = {
  id: 'google',
  name: 'Google',
  oauth: true,
  taskSource: 'gtask',
  eventSource: 'gcal',
  canSendEmail: true,

  // Lets an existing install keep the client ID it saved in Settings before config.js existed.
  setClientIdOverride(id) { clientIdOverride = id || ''; },
  isConfigured: () => !!clientId(),
  hasToken: () => !!token && Date.now() < expiresAt,
  canResumeSilently: () => false,

  async signIn({ consent = false } = {}) {
    if (!clientId()) throw new Error('Google sign-in isn’t set up for this copy of the app yet.');
    await loadGis();
    await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPES,
        callback: (r) => {
          if (r.error) return reject(new Error(r.error_description || r.error));
          if (!window.google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES.split(' ').slice(3))) {
            return reject(new Error('Some permissions were unchecked. Momentum needs all of them to work. Please try again and leave them checked.'));
          }
          token = r.access_token;
          expiresAt = Date.now() + (Number(r.expires_in) - 60) * 1000;
          resolve();
        },
        error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'The Google sign-in window was closed.' : e?.type === 'popup_failed_to_open' ? 'Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.' : (e?.message || 'Google sign-in failed.'))),
      });
      client.requestAccessToken({ prompt: consent ? 'consent' : '' });
    });
  },

  async ensureToken() {
    if (!google.hasToken()) await google.signIn();
  },

  signOut() {
    if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
    token = null;
    expiresAt = 0;
  },

  async profile() {
    const p = await api('https://openidconnect.googleapis.com/v1/userinfo');
    return { name: p.given_name || p.name || '', email: p.email || '' };
  },

  async fetchTasks() {
    const lists = await pages('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100', 'items');
    const all = [];
    for (const list of lists) {
      const items = await pages(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=true&showHidden=true&maxResults=100`,
        'items',
      );
      for (const t of items) {
        if (t.deleted || !t.title?.trim()) continue;
        all.push({
          id: `gtask:${t.id}`, source: 'gtask', kind: 'task',
          remoteId: t.id, listId: list.id, listTitle: list.title,
          title: t.title.trim(), notes: t.notes || '',
          due: t.due ? dateOnlyToLocalDue(t.due.slice(0, 10)) : null, allDay: true,
          completedAt: t.status === 'completed' ? (t.completed || t.updated) : null,
          link: t.webViewLink || 'https://tasks.google.com/',
        });
      }
    }
    return all;
  },

  async fetchEvents() {
    const now = new Date();
    const params = new URLSearchParams({
      timeMin: addDays(startOfDay(now), -7).toISOString(),
      timeMax: new Date(now.getTime() + 30 * DAY).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    });
    const events = await pages(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, 'items');
    return events
      .filter((e) => e.status !== 'cancelled' && (!e.eventType || e.eventType === 'default' || e.eventType === 'fromGmail'))
      .map((e) => {
        const allDay = !e.end?.dateTime;
        // All-day end dates are exclusive, so the event is due the day before.
        const due = allDay ? dateOnlyToLocalDue(e.end.date, -1) : new Date(e.end.dateTime).toISOString();
        return {
          id: `gcal:${e.id}`, source: 'gcal', kind: 'event', remoteId: e.id,
          title: (e.summary || '(No title)').trim(),
          notes: (e.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          due, allDay, link: e.htmlLink,
        };
      });
  },

  patchTask(t, changes) {
    const body = {};
    if ('completed' in changes) {
      body.status = changes.completed ? 'completed' : 'needsAction';
      body.completed = changes.completed ? new Date().toISOString() : null;
    }
    if ('due' in changes) body.due = changes.due ? dueField(changes.due) : null;
    return api(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(t.listId)}/tasks/${encodeURIComponent(t.remoteId)}`, {
      method: 'PATCH', body: JSON.stringify(body),
    });
  },

  async createTask({ title, notes, due }) {
    const t = await api('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, notes: notes || undefined, due: due ? dueField(due) : undefined }),
    });
    return { id: `gtask:${t.id}`, source: 'gtask', remoteId: t.id, listId: '@default', listTitle: 'My Tasks', link: t.webViewLink, allDay: true };
  },

  sendEmail(to, subject, text) {
    const clean = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
    const mime = [
      `To: ${clean(to)}`,
      `Subject: =?UTF-8?B?${b64urlText(clean(subject), false)}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      text,
    ].join('\r\n');
    return api('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', body: JSON.stringify({ raw: b64urlText(mime) }),
    });
  },
};
