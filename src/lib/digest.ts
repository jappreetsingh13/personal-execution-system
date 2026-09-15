import type { DateKey, Occurrence } from '@/types';
import { useTasksStore } from '@/store/useTasksStore';
import { addDays, eachDay, startOfWeek, timestampFor, toKey, weekdayOf } from './date';
import { expandRange } from './useOccurrences';

/**
 * The daily check-ins and the Monday statistics nudge.
 *
 * These carry live counts ("3 still to finish"), which is why they are scheduled as dated
 * one-shots over a rolling window rather than with a repeating DAILY trigger — a repeating
 * notification's body is fixed when it is created and would go stale the moment a box is ticked.
 * The trade-off is that they need the app to be opened within the horizon to stay topped up.
 */

/** Minutes past midnight for each slot. */
export const MIDDAY_MINUTES = 13 * 60; // 1:00 PM
export const EVENING_MINUTES = 21 * 60 + 30; // 9:30 PM
export const WEEKLY_MINUTES = 8 * 60; // 8:00 AM Monday

export type DigestKind = 'digest' | 'weekly';

export type DigestEntry = {
  fireAt: number;
  title: string;
  body: string;
  date: DateKey;
  kind: DigestKind;
  slot: 'midday' | 'evening' | 'weekly';
};

/**
 * Deterministic variant choice.
 *
 * Copy must not change between rebuilds — the scheduler compares a signature of the pending set to
 * decide whether to re-schedule, so random copy would make every sync churn through ~120 native
 * calls. Keying off the date gives day-to-day variety with run-to-run stability.
 */
function pick<T>(variants: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return variants[h % variants.length];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function middayCopy(date: DateKey, remaining: number): { title: string; body: string } {
  if (remaining === 0) {
    return {
      title: pick(['A free day', 'Nothing on today', 'Clear diary'], date),
      body: pick(
        [
          'Nothing scheduled — enjoy the clear run. Anything you do today is a bonus.',
          'No tasks today. Take it easy, or get a head start on tomorrow if you fancy it.',
          'Your list is empty today. Chill, and pick things up whenever suits you.',
        ],
        date,
      ),
    };
  }
  const t = plural(remaining, 'task', 'tasks');
  return {
    title: pick(['How is the day going?', 'Midday check-in', 'Still on track?'], date),
    body: pick(
      [
        `Hope the day's treating you well — ${remaining} ${t} still to finish today.`,
        `Quick check-in: ${remaining} ${t} left on today's list. Plenty of day to go.`,
        `You're halfway through. ${remaining} ${t} waiting on you today.`,
      ],
      date,
    ),
  };
}

function eveningCopy(
  date: DateKey,
  remaining: number,
  total: number,
): { title: string; body: string } {
  if (total === 0) {
    return {
      title: 'That was a quiet one',
      body: pick(
        [
          'Nothing was scheduled today. Fresh start tomorrow.',
          'No tasks on today. Rest up — tomorrow is a clean slate.',
        ],
        date,
      ),
    };
  }
  if (remaining === 0) {
    return {
      title: pick(['All clear', 'Everything done', 'Clean sweep'], date),
      body: pick(
        [
          `All ${total} done today. Nicely played — go enjoy the evening.`,
          'Every task ticked off today. That is a good day. Sleep well.',
        ],
        date,
      ),
    };
  }
  const t = plural(remaining, 'task', 'tasks');
  const it = plural(remaining, 'it', 'them');
  return {
    title: pick(['Anything left for today?', 'Before you wind down', 'One last look'], date),
    body: pick(
      [
        `${remaining} ${t} still open. Fancy a quick push, or shall we move ${it} to tomorrow?`,
        `Still ${remaining} ${t} to go. Knock ${it} out now, or shift ${it} forward so nothing slips.`,
        `${remaining} ${t} unfinished. A few minutes now, or push ${it} to tomorrow so you don't forget.`,
      ],
      date,
    ),
  };
}

function weeklyCopy(date: DateKey, done: number, total: number): { title: string; body: string } {
  if (total === 0) {
    return {
      title: 'Your week in review',
      body: 'Last week was quiet — nothing scheduled. Statistics are ready whenever you want a look.',
    };
  }
  const rate = Math.round((done / total) * 100);
  return {
    title: 'Your week in review',
    body: `Last week you finished ${done} of ${total} (${rate}%). Tap to see the full breakdown.`,
  };
}

function remainingOn(list: Occurrence[]): number {
  return list.filter((o) => o.status !== 'done').length;
}

/**
 * Build every digest that should be pending between now and `horizonDays` out.
 *
 * Counts for today reflect what is actually left right now; future days necessarily count
 * everything scheduled, since nothing can be done yet.
 */
export function buildDigestEntries(now: number, horizonDays: number): DigestEntry[] {
  const { tasks, occurrences } = useTasksStore.getState();
  const from = toKey(new Date(now));
  const to = addDays(from, horizonDays);

  const all = expandRange(tasks, occurrences, from, to, now);
  const byDate = new Map<DateKey, Occurrence[]>();
  for (const o of all) {
    const list = byDate.get(o.date);
    if (list) list.push(o);
    else byDate.set(o.date, [o]);
  }

  const out: DigestEntry[] = [];

  for (const date of eachDay(from, to)) {
    const list = byDate.get(date) ?? [];
    const total = list.length;
    const remaining = remainingOn(list);

    const middayAt = timestampFor(date, MIDDAY_MINUTES);
    if (middayAt > now) {
      const { title, body } = middayCopy(date, remaining);
      out.push({ fireAt: middayAt, title, body, date, kind: 'digest', slot: 'midday' });
    }

    const eveningAt = timestampFor(date, EVENING_MINUTES);
    if (eveningAt > now) {
      const { title, body } = eveningCopy(date, remaining, total);
      out.push({ fireAt: eveningAt, title, body, date, kind: 'digest', slot: 'evening' });
    }

    // Monday morning: report on the week that just ended, which sits before the expansion window
    // above, so it needs its own lookup.
    if (weekdayOf(date) === 1) {
      const weeklyAt = timestampFor(date, WEEKLY_MINUTES);
      if (weeklyAt > now) {
        const lastMonday = addDays(startOfWeek(date), -7);
        const lastSunday = addDays(lastMonday, 6);
        const lastWeek = expandRange(tasks, occurrences, lastMonday, lastSunday, now);
        const done = lastWeek.filter((o) => o.status === 'done').length;
        const { title, body } = weeklyCopy(date, done, lastWeek.length);
        out.push({ fireAt: weeklyAt, title, body, date, kind: 'weekly', slot: 'weekly' });
      }
    }
  }

  return out.sort((a, b) => a.fireAt - b.fireAt);
}
