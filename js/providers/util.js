// "YYYY-MM-DD" → that local day at 23:59, so date-only dues go overdue only after the day ends.
export function dateOnlyToLocalDue(ymd, offsetDays = 0) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d + offsetDays, 23, 59).toISOString();
}

export function b64urlBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Base64 of UTF-8 text; URL-safe unless `urlSafe` is false (MIME encoded-words need plain base64).
export function b64urlText(str, urlSafe = true) {
  const bytes = new TextEncoder().encode(str);
  if (urlSafe) return b64urlBytes(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function fetchJson(url, token, opts = {}, onUnauthorized = () => {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new Error('Your session expired. Tap sync to sign in again.');
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || j.error_description || msg; } catch { /* keep status */ }
    throw new Error(`Couldn’t reach your account (${msg}).`);
  }
  return res.status === 202 || res.status === 204 ? null : res.json();
}
