// Sample data so the app can be tried without a Google account.
// History is shaped so this week trails last week, which shows the "slipping" coaching;
// finishing a few tasks flips it to "building momentum".
import { addDays, startOfWeek, diffDays } from './dates.js';

const DONE_TITLES = [
  'Reply to vendor contract email', 'Update project roadmap', 'Grocery run', 'Pay electricity bill',
  'Draft blog post outline', 'Schedule car service', 'Clean up shared drive', 'Send invoice #1042',
  'Prep agenda for team sync', 'Call mom', 'Review pull request', 'Book flights for conference',
  'Water the plants', 'Renew gym membership', 'Back up laptop', 'Write weekly status update',
  'Return library books', 'File receipts', 'Order birthday gift', 'Fix leaky faucet',
  'Read chapter of book', 'Plan meals for the week', 'Update resume', 'Organize inbox',
];

function at(base, dayOffset, h, m = 0) {
  const d = addDays(base, dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

const notifyOff = () => ({ enabled: false, channel: 'email', to: '' });

export function demoTasks(now = new Date()) {
  const tasks = {};
  const add = (t) => { tasks[t.id] = { notify: notifyOff(), notes: '', kind: t.source === 'gcal' ? 'event' : 'task', ...t }; };
  let n = 0;
  const today = (h, m) => at(now, 0, h, m).toISOString();
  const day = (off) => { const d = at(now, off, 23, 59); return d.toISOString(); };

  // Open tasks
  add({ id: `demo:${n++}`, source: 'gtask', title: 'Send Q4 budget draft to finance', due: day(-2), allDay: true,
    notify: { enabled: true, channel: 'email', to: 'jordan@example.com' }, notes: 'Use the revised headcount numbers.' });
  add({ id: `demo:${n++}`, source: 'gtask', title: 'Review onboarding deck', due: day(-1), allDay: true });
  add({ id: `demo:${n++}`, source: 'gtask', title: 'Submit expense report', due: day(0), allDay: true,
    notify: { enabled: true, channel: 'sms', to: '+15555550123' } });
  add({ id: `demo:${n++}`, source: 'gcal', title: 'Call the landlord about the lease', due: today(17, 0), allDay: false });
  add({ id: `demo:${n++}`, source: 'gcal', title: '1:1 with Priya', due: at(now, 1, 14, 30).toISOString(), allDay: false });
  add({ id: `demo:${n++}`, source: 'gtask', title: 'Prep slides for client review', due: day(3), allDay: true });
  add({ id: `demo:${n++}`, source: 'gtask', title: 'Renew car registration', due: day(6), allDay: true });
  add({ id: `demo:${n++}`, source: 'gtask', title: 'Book dentist appointment', due: null, allDay: true });
  add({ id: `demo:${n++}`, source: 'gtask', title: 'Pick up dry cleaning', due: null, allDay: true });
  add({ id: `demo:${n++}`, source: 'gtask', title: 'Plan weekend hike', due: null, allDay: true });

  // Completed history
  const ws = startOfWeek(now);
  const todayIdx = diffDays(now, ws); // 0 = Monday
  let ti = 0;
  const done = (date, late = false) => {
    const due = new Date(date);
    due.setHours(23, 59, 0, 0);
    if (late) due.setDate(due.getDate() - 1);
    add({ id: `demo:${n++}`, source: ti % 3 ? 'gtask' : 'gcal', title: DONE_TITLES[ti++ % DONE_TITLES.length],
      due: due.toISOString(), allDay: true, completedAt: date.toISOString() });
  };

  // This week: a slow start (completions only on days before today).
  const thisWeekPlan = [1, 1, 0, 1, 1, 0, 0];
  for (let d = 0; d < todayIdx; d++) for (let k = 0; k < thisWeekPlan[d]; k++) done(at(ws, d, 10 + k * 3, 15));

  // Previous weeks, oldest last. Last week was strong.
  const weekly = [
    [2, 1, 1, 2, 1, 3, 2], // last week: 12
    [1, 2, 1, 2, 1, 1, 1], // 9
    [2, 1, 1, 1, 2, 1, 0], // 8
    [1, 1, 2, 1, 1, 0, 1], // 7
    [1, 1, 1, 1, 1, 1, 0], // 6
    [1, 0, 1, 1, 1, 1, 0], // 5
    [1, 1, 0, 1, 1, 0, 1], // 5
    [0, 1, 1, 0, 1, 1, 0],
    [1, 0, 1, 1, 0, 0, 1],
    [0, 1, 0, 1, 1, 0, 0],
    [1, 1, 0, 0, 1, 0, 0],
    [0, 1, 1, 0, 0, 1, 0],
  ];
  weekly.forEach((days, i) => {
    const start = addDays(ws, -7 * (i + 1));
    days.forEach((count, d) => {
      for (let k = 0; k < count; k++) done(at(start, d, 9 + k * 4, 30), (d + k + i) % 5 === 0);
    });
  });

  return tasks;
}
