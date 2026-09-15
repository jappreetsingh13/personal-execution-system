import type { DateKey, Recurrence, Task } from '@/types';
import { addDays, daysBetween, eachDay, fromKey, todayKey, weekdayOf, WEEKDAY_NAMES } from './date';

/**
 * Occurrence expansion.
 *
 * Nothing per-day is stored for a task — given a task and a date we can answer
 * "does it happen then?" from the rule alone. That keeps a Mon–Fri task showing
 * on every weekday forever without materialising rows, and means editing the
 * rule instantly rewrites past and future views alike.
 */

/** Does `task` occur on `date`? */
export function occursOn(task: Task, date: DateKey): boolean {
  if (date < task.startDate) return false;
  if (task.endDate && date > task.endDate) return false;

  const r = task.recurrence;
  switch (r.kind) {
    case 'once':
      return date === task.startDate;
    case 'daily':
      return true;
    case 'weekdays':
      return r.days.includes(weekdayOf(date));
    case 'alternate':
      // Counted from startDate, so the anchor day itself always counts.
      return daysBetween(task.startDate, date) % 2 === 0;
    case 'custom':
      return r.dates.includes(date);
    default:
      return false;
  }
}

/** Every date in [from, to] on which `task` occurs. */
export function datesInRange(task: Task, from: DateKey, to: DateKey): DateKey[] {
  // `custom` is a finite set — intersect directly instead of walking the range.
  if (task.recurrence.kind === 'custom') {
    return task.recurrence.dates
      .filter((d) => d >= from && d <= to && occursOn(task, d))
      .sort();
  }
  if (task.recurrence.kind === 'once') {
    return occursOn(task, task.startDate) && task.startDate >= from && task.startDate <= to
      ? [task.startDate]
      : [];
  }
  return eachDay(from, to).filter((d) => occursOn(task, d));
}

/** Human-readable rule, e.g. 'Mon–Fri' or 'Every other day'. */
export function describeRecurrence(r: Recurrence): string {
  switch (r.kind) {
    case 'once':
      return 'One time';
    case 'daily':
      return 'Every day';
    case 'alternate':
      return 'Every other day';
    case 'custom':
      return `${r.dates.length} selected ${r.dates.length === 1 ? 'date' : 'dates'}`;
    case 'weekdays': {
      const days = [...r.days].sort((a, b) => a - b);
      if (days.length === 0) return 'No days selected';
      if (days.length === 7) return 'Every day';
      if (days.join() === '1,2,3,4,5') return 'Mon–Fri';
      if (days.join() === '0,6') return 'Weekends';
      return days.map((d) => WEEKDAY_NAMES[d]).join(', ');
    }
    default:
      return '';
  }
}

/**
 * The next date on or after `from` on which `task` occurs, or null within
 * `limitDays`. Used by the scheduler and the "next up" hints.
 */
/**
 * Which day to show when a task is opened without one — from a note's linked-task chip, say.
 *
 * Defaulting to today is wrong and actively misleading: a task that ran yesterday has its state
 * (including "done") filed under yesterday, so today's view finds nothing, renders Not Started, and
 * flags it Overdue because today's slot has already passed. Prefer today only when the task really
 * occurs today, then the next upcoming day, then the most recent past one.
 */
export function defaultContextDate(
  task: Task,
  today: DateKey = todayKey(),
  limitDays = 120,
): DateKey {
  if (occursOn(task, today)) return today;

  const upcoming = nextOccurrence(task, today, limitDays);
  if (upcoming) return upcoming;

  for (let i = 1; i <= limitDays; i++) {
    const key = addDays(today, -i);
    if (key < task.startDate) break;
    if (occursOn(task, key)) return key;
  }

  return task.startDate;
}

export function nextOccurrence(task: Task, from: DateKey, limitDays = 400): DateKey | null {
  const d = fromKey(from);
  for (let i = 0; i < limitDays; i++) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    if (occursOn(task, key)) return key;
    if (task.endDate && key > task.endDate) return null;
    d.setDate(d.getDate() + 1);
  }
  return null;
}
