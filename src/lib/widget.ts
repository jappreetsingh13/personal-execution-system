import { StreakWidget } from '../../modules/expo-widget';
import type { DateKey, OccurrenceState, Task } from '@/types';
import { useTasksStore } from '@/store/useTasksStore';
import { addDays, todayKey } from './date';
import { expandRange } from './useOccurrences';

/**
 * The home-screen widget's data source. JS computes the numbers — the streak
 * rule lives next to the data it counts — and pushes them over the bridge;
 * the widget itself only ever reads the last-pushed values, so it renders with
 * no app process running.
 */

/**
 * Consecutive days with at least one completed task, ending today — or
 * yesterday, if today's first tick hasn't happened yet. Like Duolingo, the
 * streak is "not broken yet" until a whole day passes with nothing done.
 */
export function computeStreak(occurrences: Record<string, OccurrenceState>): number {
  const doneDays = new Set<DateKey>();
  for (const [key, state] of Object.entries(occurrences)) {
    if (state.status !== 'done') continue;
    const sep = key.lastIndexOf('|');
    if (sep > 0) doneDays.add(key.slice(sep + 1));
  }
  if (doneDays.size === 0) return 0;

  let cursor = todayKey();
  if (!doneDays.has(cursor)) cursor = addDays(cursor, -1);

  let streak = 0;
  while (doneDays.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Push fresh numbers to the native widget store. No-op when unavailable (Expo Go). */
export function syncWidget(): void {
  if (!StreakWidget.available) return;
  try {
    const { tasks, occurrences } = useTasksStore.getState();
    const { done, total } = todayProgress(tasks, occurrences);
    StreakWidget.updateData(computeStreak(occurrences), done, total);
  } catch (err) {
    console.warn('[widget] sync failed', err);
  }
}

export function todayProgress(
  tasks: Record<string, Task>,
  occurrences: Record<string, OccurrenceState>,
): { done: number; total: number } {
  const today = todayKey();
  const day = expandRange(tasks, occurrences, today, today, Date.now());
  return {
    done: day.filter((o) => o.status === 'done').length,
    total: day.length,
  };
}
