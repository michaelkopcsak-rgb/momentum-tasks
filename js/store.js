const KEY = 'momentum-tasks.v1';

export function defaultState() {
  return {
    onboarded: false,
    mode: null, // 'demo' | 'live'
    provider: null, // 'google' | 'microsoft' | 'ics'
    choice: null, // what they picked in onboarding: google, microsoft, yahoo, apple, other
    account: null, // { name, email }
    tasks: {},
    lastSync: null,
    settings: {
      clientId: '', // legacy: Google client ID pasted in Settings before config.js
      includeEvents: true,
      defaultChannel: 'email',
      defaultRecipient: '',
    },
  };
}

const kindFor = (source) => (source === 'gcal' || source === 'mscal' ? 'event' : source === 'local' ? 'local' : 'task');

function migrate(s) {
  // v1 stored mode: 'google' and had no onboarding or provider fields.
  if (s.mode === 'google') { s.mode = 'live'; s.provider = 'google'; s.choice = 'google'; }
  if (s.onboarded === undefined) s.onboarded = !!s.mode;
  for (const t of Object.values(s.tasks || {})) if (!t.kind) t.kind = kindFor(t.source);
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = migrate(JSON.parse(raw));
    return { ...defaultState(), ...s, settings: { ...defaultState().settings, ...s.settings } };
  } catch {
    return defaultState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the app keeps working for this session.
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// The due date the app should use: a local override (for read-only sources) wins.
export const effDue = (t) => t.dueLocal || t.due || null;
export const isOpen = (t) => !t.completedAt && !t.hidden;
export const isOverdue = (t, now = new Date()) => isOpen(t) && effDue(t) && new Date(effDue(t)) < now;
