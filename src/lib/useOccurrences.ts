import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { DateKey, Occurrence, OccurrenceState, StatsRange, Task } from '@/types';
import { useTasksStore } from '@/store/useTasksStore';
import { buildOccurrence, byTime, occKey } from './status';
import { datesInRange } from './recurrence';
import { addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek, todayKey } from './date';

/**
 * A "now" that ticks, so an occurrence flips to overdue on its own without the
 * user touching anything. Also resyncs on foreground, since timers are
 * unreliable while the app is backgrounded.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalRef.current);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  return now;
}

/**
 * Expand every occurrence falling on [from, to].
 *
 * Two passes, because a moved occurrence lives under its ORIGINAL date key:
 *   1. natural occurrences, skipping any that were moved away
 *   2. occurrences moved INTO this range from a date outside it
 *
 * Without the second pass, pushing a task to tomorrow would make it vanish
 * rather than move.
 */
export function expandRange(
  tasks: Record<string, Task>,
  occurrences: Record<string, OccurrenceState>,
  from: DateKey,
  to: DateKey,
  now: number,
): Occurrence[] {
  const out: Occurrence[] = [];

  for (const task of Object.values(tasks)) {
    for (const date of datesInRange(task, from, to)) {
      const state = occurrences[occKey(task.id, date)];
      if (state?.skipped) continue;
      // Moved away — it will be emitted on its destination day instead.
      if (state?.movedTo) continue;
      out.push(buildOccurrence(task, date, state, now));
    }
  }

  // Pass 2: anything whose destination lands inside the window. Scanning the
  // deviation map is cheap because only *changed* days have records at all.
  for (const [key, state] of Object.entries(occurrences)) {
    const movedTo = state.movedTo;
    if (!movedTo || movedTo < from || movedTo > to) continue;
    if (state.skipped) continue;

    const sep = key.lastIndexOf('|');
    const taskId = key.slice(0, sep);
    const originalDate = key.slice(sep + 1);
    const task = tasks[taskId];
    if (!task) continue;

    out.push(
      buildOccurrence(task, movedTo, state, now, {
        stateDate: originalDate,
        movedFrom: originalDate,
      }),
    );
  }

  return out;
}

/** Every occurrence on a single day, in time order. */
export function useDayOccurrences(date: DateKey, now: number): Occurrence[] {
  const tasks = useTasksStore((s) => s.tasks);
  const occurrences = useTasksStore((s) => s.occurrences);

  return useMemo(
    () => expandRange(tasks, occurrences, date, date, now).sort(byTime),
    [tasks, occurrences, date, now],
  );
}

/** Every occurrence across an inclusive date range, in date-then-time order. */
export function useRangeOccurrences(from: DateKey, to: DateKey, now: number): Occurrence[] {
  const tasks = useTasksStore((s) => s.tasks);
  const occurrences = useTasksStore((s) => s.occurrences);

  return useMemo(
    () =>
      expandRange(tasks, occurrences, from, to, now).sort((a, b) =>
        a.date === b.date ? byTime(a, b) : a.date.localeCompare(b.date),
      ),
    [tasks, occurrences, from, to, now],
  );
}

/** Which days in a window have at least one occurrence — for the date strip dots. */
export function useMarkedDates(from: DateKey, to: DateKey): Set<DateKey> {
  const tasks = useTasksStore((s) => s.tasks);
  const occurrences = useTasksStore((s) => s.occurrences);

  return useMemo(() => {
    const marked = new Set<DateKey>();
    for (const o of expandRange(tasks, occurrences, from, to, 0)) marked.add(o.date);
    return marked;
  }, [tasks, occurrences, from, to]);
}

/** Resolve a Statistics filter into a concrete inclusive date range. */
export function rangeBounds(
  range: StatsRange,
  anchor: DateKey = todayKey(),
): { from: DateKey; to: DateKey; label: string } {
  switch (range) {
    case 'daily':
      return { from: anchor, to: anchor, label: 'Today' };
    case 'weekly':
      return { from: startOfWeek(anchor), to: endOfWeek(anchor), label: 'This week' };
    case 'monthly':
      return { from: startOfMonth(anchor), to: endOfMonth(anchor), label: 'This month' };
    case 'yearly':
      // Rolling 12 months rather than the calendar year, so the view always
      // spans a full year of history instead of shrinking every January.
      return {
        from: addMonths(anchor, -11),
        to: endOfMonth(anchor),
        label: 'Last 12 months',
      };
  }
}
