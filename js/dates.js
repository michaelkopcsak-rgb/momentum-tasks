export const DAY = 864e5;

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Weeks start on Monday.
export function startOfWeek(d) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function diffDays(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY);
}

export const sameDay = (a, b) => diffDays(a, b) === 0;

// "YYYY-MM-DD" for <input type="date">, in local time.
export function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toTimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// All-day dues are stored as 23:59 local so they don't go overdue until the day ends.
export function fromInputs(dateStr, timeStr) {
  if (!dateStr) return { due: null, allDay: true };
  const [y, m, d] = dateStr.split('-').map(Number);
  if (timeStr) {
    const [h, min] = timeStr.split(':').map(Number);
    return { due: new Date(y, m - 1, d, h, min).toISOString(), allDay: false };
  }
  return { due: new Date(y, m - 1, d, 23, 59).toISOString(), allDay: true };
}

export function fmtTime(d) {
  return new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDayLabel(d, now = new Date()) {
  const days = diffDays(d, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return new Date(d).toLocaleDateString([], { weekday: 'long' });
  const sameYear = new Date(d).getFullYear() === now.getFullYear();
  return new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function fmtShort(d) {
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
