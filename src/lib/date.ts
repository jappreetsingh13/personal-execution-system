import type { DateKey } from '@/types';

/**
 * All date maths here is deliberately *local-time* and calendar-based.
 *
 * A DateKey is 'YYYY-MM-DD' built from local getFullYear/Month/Date — never
 * from toISOString(), which would shift the day across the UTC boundary and
 * put an 11pm task on tomorrow's timeline.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a DateKey into a local Date at midnight. */
export function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function todayKey(): DateKey {
  return toKey(new Date());
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return toKey(d);
}

/** Whole calendar days between two keys (b - a). DST-safe via midday anchoring. */
export function daysBetween(a: DateKey, b: DateKey): number {
  const da = fromKey(a);
  const db = fromKey(b);
  da.setHours(12, 0, 0, 0);
  db.setHours(12, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** Epoch ms for a given day + minutes-past-midnight, in local time. */
export function timestampFor(key: DateKey, minutes: number): number {
  const d = fromKey(key);
  d.setMinutes(minutes);
  return d.getTime();
}

export function weekdayOf(key: DateKey): number {
  return fromKey(key).getDay();
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 1200 -> '8:00 PM'. */
export function formatTime(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

/** Hour-row label for the day timeline: 20 -> '8 PM'. */
export function formatHour(hour: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${suffix}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const WEEKDAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '13 September 2026'. */
export function formatLongDate(key: DateKey): string {
  const d = fromKey(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** 'Saturday, 13 September'. */
export function formatDayHeading(key: DateKey): string {
  const d = fromKey(key);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** '13 Sep'. */
export function formatShortDate(key: DateKey): string {
  const d = fromKey(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/** 'Today' / 'Yesterday' / 'Tomorrow', else a short date. */
export function formatRelativeDay(key: DateKey): string {
  const diff = daysBetween(todayKey(), key);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return formatShortDate(key);
}

// ---------------------------------------------------------------------------
// Ranges — used by both the date strip and the Statistics filters
// ---------------------------------------------------------------------------

/** Monday-based start of the week containing `key`. */
export function startOfWeek(key: DateKey): DateKey {
  const dow = weekdayOf(key);
  const backToMonday = (dow + 6) % 7;
  return addDays(key, -backToMonday);
}

export function endOfWeek(key: DateKey): DateKey {
  return addDays(startOfWeek(key), 6);
}

export function startOfMonth(key: DateKey): DateKey {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Shift by whole months, always landing on the 1st. Handles year wrap. */
export function addMonths(key: DateKey, months: number): DateKey {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth() + months, 1));
}

/** 'Sep 2026' — the label for a month column in the yearly summary. */
export function formatMonthLabel(key: DateKey): string {
  const d = fromKey(key);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** 'Sep' — compact label for the 12-month bar chart. */
export function formatMonthShort(key: DateKey): string {
  return MONTHS[fromKey(key).getMonth()].slice(0, 3);
}

export function endOfMonth(key: DateKey): DateKey {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Inclusive list of every DateKey from `from` to `to`. */
export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  const span = daysBetween(from, to);
  if (span < 0) return out;
  for (let i = 0; i <= span; i++) out.push(addDays(from, i));
  return out;
}
