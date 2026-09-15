/** Importance level 1..5 — drives the 5 colour marks on notes and tasks. */
export type Importance = 1 | 2 | 3 | 4 | 5;

/** A calendar day in local time, formatted 'YYYY-MM-DD'. */
export type DateKey = string;

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * A named collapsible block inside a note or task — the accordion sections for
 * links, references, and anything that deserves its own heading.
 */
export type Section = {
  id: string;
  title: string;
  body: string;
  /** Collapsed state is persisted so a long note reopens the way you left it. */
  collapsed?: boolean;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  importance: Importance;
  /** Many-to-many: a note can back any number of tasks. */
  linkedTaskIds: string[];
  sections: Section[];
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * How a task repeats. `once` is a single day; the rest generate occurrences
 * lazily for whatever range is being viewed (see lib/recurrence.ts).
 */
export type Recurrence =
  | { kind: 'once' }
  | { kind: 'daily' }
  /** `days` holds JS weekday numbers, 0=Sun..6=Sat. Mon–Fri is [1,2,3,4,5]. */
  | { kind: 'weekdays'; days: number[] }
  /** Every other day, counted from `startDate`. */
  | { kind: 'alternate' }
  /** An explicit hand-picked set of dates. */
  | { kind: 'custom'; dates: DateKey[] };

export type Task = {
  id: string;
  title: string;
  details?: string;
  importance: Importance;
  /** Minutes past local midnight — the "@8pm" (20 * 60 = 1200). */
  minutes: number;
  recurrence: Recurrence;
  /** First day the task is active. For `once`, the only day. */
  startDate: DateKey;
  /** Optional last active day (inclusive). */
  endDate?: DateKey;
  /** Many-to-many: a task can reference any number of notes. */
  linkedNoteIds: string[];
  sections: Section[];
  /** Fire the T-30min and T-5min reminders. */
  remindersEnabled: boolean;
  /** Also fire an alarm at T-0 that opens the full-screen ringer. */
  alarmEnabled: boolean;
  createdAt: number;
  updatedAt: number;
};

/**
 * Per-day deviation from a task's default state.
 *
 * Occurrences are *computed*, never stored — only the days that differ from
 * the default get a record here, keyed `${taskId}|${dateKey}`. That is what
 * lets one day's 5pm shift to 7pm while the recurrence rule stays intact, and
 * keeps a Monday tick from ticking Tuesday.
 */
export type OccurrenceState = {
  status?: 'in_progress' | 'done';
  startedAt?: number;
  completedAt?: number;
  /** Overrides `Task.minutes` for this day only. */
  timeOverride?: number;
  /** Soft-skip this single day without touching the rule. */
  skipped?: boolean;
  /**
   * This occurrence was pushed to a later day. The record stays keyed under the
   * ORIGINAL date, so the date it came from is never lost — that original is
   * what gets shown as "moved from" on the new day.
   */
  movedTo?: DateKey;
};

/** The 3 buckets shown in Statistics. */
export type TaskStatus = 'done' | 'in_progress' | 'not_started';

/** A task resolved against one specific date — what the UI actually renders. */
export type Occurrence = {
  task: Task;
  /** The day this is being shown on (the destination, if it was moved). */
  date: DateKey;
  /**
   * Where the deviation record lives — the original date for a moved
   * occurrence, otherwise the same as `date`. Every mutation must be keyed by
   * this, not by `date`, or a moved task would write to the wrong day.
   */
  stateDate: DateKey;
  /** Set only when moved, for the "moved from" badge. */
  movedFrom?: DateKey;
  /** Effective time for this day (respects `timeOverride`). */
  minutes: number;
  status: TaskStatus;
  /** True when its moment has passed and it is still not done. */
  overdue: boolean;
  startedAt?: number;
  completedAt?: number;
  /** Epoch ms of this occurrence's scheduled moment. */
  timestamp: number;
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ThemeName = 'blossom' | 'midnight' | 'harbor' | 'daylight';
export type AlarmTune = 'alarm_classic' | 'alarm_pulse';
export type NotificationTune = 'notify_chime' | 'notify_ping';

export type StatsRange = 'daily' | 'weekly' | 'monthly' | 'yearly';
