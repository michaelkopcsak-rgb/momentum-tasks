// Calendar file import (.ics, RFC 5545) for providers with no browser sign-in API:
// Yahoo, Apple iCloud and anything else that can export a calendar.
// Events (VEVENT) and to-dos (VTODO) are read once; completions and due dates are kept in the app.
import { DAY, addDays, startOfDay } from '../dates.js';
import { dateOnlyToLocalDue } from './util.js';

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

// Returns { iso, dateOnly } or null. Floating and TZID times are read as local time.
function parseDate(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || prop.params.VALUE === 'DATE') return { ymd: `${y}-${mo}-${d}`, dateOnly: true };
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)))
    : new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  return { iso: date.toISOString(), dateOnly: false };
}

export function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const comps = [];
  let cur = null;
  let skipDepth = 0;
  for (const line of lines) {
    if (/^BEGIN:(VEVENT|VTODO)$/i.test(line)) { cur = { type: line.slice(6).toUpperCase(), props: {} }; continue; }
    if (/^END:(VEVENT|VTODO)$/i.test(line)) { if (cur) comps.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) { skipDepth++; continue; } // VALARM etc.
    if (/^END:/i.test(line)) { skipDepth = Math.max(0, skipDepth - 1); continue; }
    if (skipDepth) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(';');
    cur.props[name.toUpperCase()] = {
      value: line.slice(colon + 1),
      params: Object.fromEntries(params.map((p) => { const [k, ...v] = p.split('='); return [k.toUpperCase(), v.join('=')]; })),
    };
  }
  return comps;
}

export function icsToItems(text, now = new Date()) {
  const comps = parseICS(text);
  if (!comps.length) throw new Error('No events or to-dos were found in that file. Make sure it’s an .ics calendar file.');
  const from = addDays(startOfDay(now), -7);
  const to = new Date(now.getTime() + 30 * DAY);
  const items = [];
  const seen = new Set();
  for (const c of comps) {
    const p = c.props;
    const uid = (p.UID?.value || `${p.SUMMARY?.value}-${p.DTSTART?.value || p.DUE?.value}`) + (p['RECURRENCE-ID'] ? `@${p['RECURRENCE-ID'].value}` : '');
    const id = `ics:${uid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = unescapeText(p.SUMMARY?.value || '(No title)');
    const notes = p.DESCRIPTION ? unescapeText(p.DESCRIPTION.value).slice(0, 1000) : '';
    const status = p.STATUS?.value?.toUpperCase();
    if (status === 'CANCELLED') continue;

    if (c.type === 'VTODO') {
      const due = parseDate(p.DUE);
      const done = parseDate(p.COMPLETED) || (status === 'COMPLETED' ? parseDate(p['LAST-MODIFIED']) || parseDate(p.DTSTAMP) : null);
      items.push({
        id, source: 'ics', kind: 'task', title, notes,
        due: due ? (due.dateOnly ? dateOnlyToLocalDue(due.ymd) : due.iso) : null,
        allDay: !due || due.dateOnly,
        completedAt: done ? (done.iso || dateOnlyToLocalDue(done.ymd)) : null,
      });
      continue;
    }

    const end = parseDate(p.DTEND) || parseDate(p.DTSTART);
    if (!end) continue;
    const allDay = end.dateOnly;
    // All-day DTEND is exclusive; a DTSTART-only all-day event is due that day.
    const due = allDay ? dateOnlyToLocalDue(end.ymd, p.DTEND ? -1 : 0) : end.iso;
    const d = new Date(due);
    if (d < from || d > to) continue; // only the past week and next 30 days, like the live sources
    items.push({ id, source: 'ics', kind: 'event', title, notes, due, allDay });
  }
  return items;
}

export const ics = {
  id: 'ics',
  name: 'Calendar file',
  oauth: false,
  taskSource: 'ics',
  eventSource: 'ics',
  canSendEmail: false,
  isConfigured: () => true,
  canResumeSilently: () => false,
  async readFile(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('That file is over 10 MB. Export a single calendar, or a shorter date range.');
    return icsToItems(await file.text());
  },
};
