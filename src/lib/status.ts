import type { DateKey, Occurrence, OccurrenceState, Task, TaskStatus } from '@/types';
import { timestampFor } from './date';

/** Storage key for a single day's deviation record. */
export function occKey(taskId: string, date: DateKey): string {
  return `${taskId}|${date}`;
}

/**
 * Resolve one task on one date into what the UI renders.
 *
 * This is the ONLY place a status is decided, so the Tasks tab, the Statistics
 * bar and the drill-down list can never disagree — tick a box anywhere and all
 * three recompute from the same rule on the next render.
 *
 * Three buckets only. "Overdue" is deliberately a separate boolean rather than
 * a fourth status: an untouched task whose time has passed is still Not Started
 * — being late does not change what you did with it, it just changes how it is
 * drawn.
 */
export function resolveStatus(state: OccurrenceState | undefined): TaskStatus {
  if (state?.status === 'done') return 'done';
  // In-progress is sticky: once started it stays started until it is ticked,
  // even after its time has gone by. "Started but not finished" is the point.
  if (state?.status === 'in_progress') return 'in_progress';
  return 'not_started';
}

export function buildOccurrence(
  task: Task,
  date: DateKey,
  state: OccurrenceState | undefined,
  now: number,
  options?: { stateDate?: DateKey; movedFrom?: DateKey },
): Occurrence {
  const minutes = state?.timeOverride ?? task.minutes;
  const timestamp = timestampFor(date, minutes);
  const status = resolveStatus(state);
  return {
    task,
    date,
    stateDate: options?.stateDate ?? date,
    movedFrom: options?.movedFrom,
    minutes,
    timestamp,
    status,
    overdue: status !== 'done' && timestamp <= now,
    startedAt: state?.startedAt,
    completedAt: state?.completedAt,
  };
}

/** Chronological sort, with a stable title tiebreak so equal times don't jitter. */
export function byTime(a: Occurrence, b: Occurrence): number {
  if (a.minutes !== b.minutes) return a.minutes - b.minutes;
  return a.task.title.localeCompare(b.task.title);
}

export type StatusCounts = Record<TaskStatus, number> & { total: number };

export function countByStatus(occurrences: Occurrence[]): StatusCounts {
  const counts: StatusCounts = {
    done: 0,
    in_progress: 0,
    not_started: 0,
    total: occurrences.length,
  };
  for (const o of occurrences) counts[o.status] += 1;
  return counts;
}
