import { DAY, startOfDay, startOfWeek, addDays, diffDays } from './dates.js';
import { effDue, isOpen, isOverdue } from './store.js';

const XP_PER_TASK = 10;
const XP_ON_TIME = 5;
const LEVEL_NAMES = ['Starter', 'Mover', 'Doer', 'Driver', 'Closer', 'Powerhouse', 'Unstoppable'];

export const onTime = (t) => !effDue(t) || new Date(t.completedAt) <= new Date(effDue(t));

function countIn(done, from, to) {
  return done.filter((t) => { const c = new Date(t.completedAt); return c >= from && c < to; }).length;
}

// Share of tasks due in [from, to) that were finished by `asOf`.
function rateFor(tasks, from, to, asOf) {
  const due = tasks.filter((t) => {
    if (t.hidden) return false;
    const d = effDue(t);
    if (!d) return false;
    const dd = new Date(d);
    return dd >= from && dd < to && dd <= asOf;
  });
  if (!due.length) return null;
  const finished = due.filter((t) => t.completedAt && new Date(t.completedAt) <= asOf).length;
  return finished / due.length;
}

function streaks(done, now) {
  const days = new Set(done.map((t) => startOfDay(t.completedAt).getTime()));
  // Current streak: today counts if done, otherwise the streak is still alive from yesterday.
  let cur = 0;
  let d = startOfDay(now);
  if (!days.has(d.getTime())) d = addDays(d, -1);
  while (days.has(d.getTime())) { cur++; d = addDays(d, -1); }
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const t of sorted) {
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return { current: cur, best, doneToday: days.has(startOfDay(now).getTime()) };
}

export function computeStats(taskMap, now = new Date()) {
  const tasks = Object.values(taskMap);
  const done = tasks.filter((t) => t.completedAt);
  const ws = startOfWeek(now);
  const daysElapsed = diffDays(now, ws) + 1; // 1..7
  const lastWs = addDays(ws, -7);

  // Fair comparison: this week so far vs. last week up to the same moment.
  const thisWeek = countIn(done, ws, now > ws ? new Date(now.getTime() + 1) : ws);
  const lastWeekToDate = countIn(done, lastWs, new Date(now.getTime() - 7 * DAY + 1));
  const lastWeekTotal = countIn(done, lastWs, ws);

  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const from = addDays(ws, -7 * i);
    weeks.push({ start: from, count: countIn(done, from, addDays(from, 7)), current: i === 0 });
  }
  const projected = Math.round((thisWeek / daysElapsed) * 7);
  const prior4 = weeks.slice(3, 7).map((w) => w.count);
  const avg4 = prior4.reduce((a, b) => a + b, 0) / prior4.length;

  const rateThis = rateFor(tasks, ws, addDays(ws, 7), now);
  const rateLast = rateFor(tasks, lastWs, ws, ws);

  const st = streaks(done, now);
  const onTimeCount = done.filter(onTime).length;
  const xp = done.length * XP_PER_TASK + onTimeCount * XP_ON_TIME;
  // Each level needs 100 XP more than the last: 0, 100, 300, 600, 1000, …
  const levelStart = (l) => 50 * l * (l - 1);
  let level = 1;
  while (xp >= levelStart(level + 1)) level++;
  const span = levelStart(level + 1) - levelStart(level);

  // Momentum: are you finishing more than you were at this point last week,
  // and is the share of due tasks you finish holding up?
  const countDelta = thisWeek - lastWeekToDate;
  const rateDelta = rateThis !== null && rateLast !== null ? rateThis - rateLast : 0;
  let status;
  if (countDelta > 0 || (countDelta === 0 && thisWeek > 0 && rateDelta > 0.05)) status = 'rising';
  else if (countDelta === 0 && thisWeek > 0 && rateDelta >= -0.05) status = 'steady';
  else status = 'slipping';

  const open = tasks.filter(isOpen);
  const focus = open
    .slice()
    .sort((a, b) => {
      const ao = isOverdue(a, now) ? 0 : 1, bo = isOverdue(b, now) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ad = effDue(a) ? new Date(effDue(a)) : Infinity, bd = effDue(b) ? new Date(effDue(b)) : Infinity;
      return ad - bd;
    })
    .slice(0, 3);

  const bestWeek = Math.max(0, ...weeks.map((w) => w.count));
  const milestones = [
    { icon: 'flag', name: 'First win', earned: done.length >= 1 },
    { icon: 'local_fire_department', name: '3-day streak', earned: st.best >= 3 },
    { icon: 'bolt', name: '7-day streak', earned: st.best >= 7 },
    { icon: 'military_tech', name: '10 in a week', earned: bestWeek >= 10 },
    { icon: 'workspace_premium', name: '50 tasks', earned: done.length >= 50 },
    { icon: 'trending_up', name: 'Beat last week', earned: thisWeek > lastWeekTotal && lastWeekTotal > 0 },
  ];

  return {
    status, thisWeek, lastWeekToDate, lastWeekTotal, projected, avg4, daysElapsed,
    rateThis, rateLast, weeks,
    streak: st.current, bestStreak: st.best, doneToday: st.doneToday,
    xp, level, levelName: LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)],
    levelProgress: (xp - levelStart(level)) / span, xpToNext: levelStart(level + 1) - xp,
    focus, milestones, totalDone: done.length,
    overdue: open.filter((t) => isOverdue(t, now)).length,
  };
}

export function statusCopy(s) {
  const gap = s.lastWeekToDate - s.thisWeek;
  if (s.status === 'rising') {
    return {
      icon: 'trending_up',
      headline: "You're building momentum",
      body: `${s.thisWeek} done this week, ${s.thisWeek - s.lastWeekToDate} more than at this point last week.${s.streak > 1 ? ` Your ${s.streak}-day streak is alive, so keep it going.` : ' Finish one today to start a streak.'}`,
    };
  }
  if (s.status === 'steady') {
    return {
      icon: 'trending_flat',
      headline: 'Holding steady',
      body: `You're matching last week's pace (${s.thisWeek} so far). One more task today puts you ahead.`,
    };
  }
  if (s.thisWeek === 0 && s.lastWeekToDate === 0) {
    return {
      icon: 'rocket_launch',
      headline: "Let's get moving",
      body: 'Nothing finished yet this week. Pick one small task below and check it off. Momentum starts with the first one.',
    };
  }
  return {
    icon: 'trending_down',
    headline: 'Your momentum is slipping',
    body: `You've finished ${s.thisWeek} this week vs. ${s.lastWeekToDate} by this point last week${gap > 0 ? ` (${gap} behind)` : ''}. Narrow your focus: close out these ${Math.max(1, s.focus.length)} before starting anything new.`,
  };
}
