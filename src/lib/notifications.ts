import * as Notifications from 'expo-notifications';
import type { DateKey } from '@/types';
import { useTasksStore } from '@/store/useTasksStore';
import { effectiveAlarmSound, useSettingsStore } from '@/store/useSettingsStore';
import { addDays, formatTime, todayKey, toKey } from './date';
import { expandRange } from './useOccurrences';
import { currentChannelIds, ensureChannels, isExpoGo } from './channels';
import { buildDigestEntries } from './digest';
import TaskAlarm, { type AlarmInput } from '../../modules/expo-task-alarm';

/** How far ahead reminders are scheduled. Re-run on foreground, so this window slides. */
const REMINDER_HORIZON_DAYS = 14;

/**
 * Digests reach a week out rather than a fortnight.
 *
 * Today's copy carries a live count, so ticking a box changes it and forces a rebuild of the whole
 * pending set. A shorter digest window roughly halves what that rebuild costs, and a week is ample
 * for an app you open most days.
 */
const DIGEST_HORIZON_DAYS = 7;

/**
 * Alarms reach much further ahead than reminders: they are native AlarmManager entries rather than
 * pending notifications, so they cost almost nothing, and an alarm that quietly stops existing
 * because the app was not opened for a fortnight is the worst possible failure for this feature.
 */
const ALARM_HORIZON_DAYS = 60;

/**
 * Caps on pending notification requests.
 *
 * A recurring task generates reminders forever, so scheduling them all is impossible — we schedule
 * the soonest N and refresh the window as time passes. The budgets are split so digests can never
 * crowd out task reminders (or the reverse).
 *
 * The old single cap of 56 existed for iOS's hard 64-request limit. This app is Android-only, where
 * no such limit applies, so the budgets are set by what is useful rather than by that ceiling.
 */
const REMINDER_BUDGET = 96;
const DIGEST_BUDGET = 40;

export const REMINDER_OFFSETS_MIN = [30, 5];

/** Suffix marking a one-off snooze alarm, which the rolling rebuild must not cancel. */
const SNOOZE_SUFFIX = '|snooze';

/**
 * Signature of the last set we actually scheduled, so an unchanged rebuild can be skipped. Reset it
 * whenever the OS-level set may have drifted from ours.
 */
let lastSignature: string | null = null;

export function invalidateScheduleCache(): void {
  lastSignature = null;
}

/** Stable per-occurrence alarm id, so rescheduling replaces rather than duplicates. */
export function alarmId(taskId: string, date: DateKey): string {
  return `${taskId}|${date}`;
}

export function snoozeAlarmId(taskId: string, date: DateKey): string {
  return `${taskId}|${date}${SNOOZE_SUFFIX}`;
}

/**
 * Upper bound on armed native alarms.
 *
 * A daily alarm over the horizon below is 60 entries on its own, and several such tasks would add
 * up fast. Soonest-first and capped keeps it bounded without ever dropping something imminent.
 */
const MAX_NATIVE_ALARMS = 100;

export type NotificationPayload =
  | { kind: 'reminder'; taskId: string; date: DateKey; offsetMin?: number }
  | { kind: 'alarm'; taskId: string; date: DateKey; snoozed?: boolean }
  | { kind: 'digest'; date: DateKey; slot: 'midday' | 'evening' }
  | { kind: 'weekly'; date: DateKey };

type PendingEntry = {
  fireAt: number;
  title: string;
  body: string;
  channelId: string;
  payload: NotificationPayload;
};

/** Foreground presentation — banner + list, matching SDK 57's handler shape. */
export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;

  const next = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return next.granted;
}

function reminderBody(offsetMin: number, minutes: number): string {
  return `Starts in ${offsetMin} min — ${formatTime(minutes)}`;
}

/**
 * Arm the native alarms.
 *
 * Deliberately separate from the notification rebuild, and deliberately NOT gated on the
 * notification permission: a real alarm is an AlarmManager entry plus a foreground service, and it
 * has no business disappearing because the user declined notifications.
 */
function syncAlarms(now: number): void {
  if (!TaskAlarm.available) return;

  const { tasks, occurrences } = useTasksStore.getState();
  const settings = useSettingsStore.getState();
  const soundSpec = effectiveAlarmSound(settings);

  const from = toKey(new Date(now));
  const to = addDays(from, ALARM_HORIZON_DAYS);

  const wanted: AlarmInput[] = [];
  // expandRange resolves skips, per-day time overrides and shifted days, so an occurrence moved to
  // another date is armed on the day it actually lands rather than the day it came from.
  for (const o of expandRange(tasks, occurrences, from, to, now)) {
    if (!o.task.alarmEnabled) continue;
    if (o.status === 'done') continue;
    if (o.timestamp <= now) continue;

    wanted.push({
      id: alarmId(o.task.id, o.stateDate),
      triggerAtMs: o.timestamp,
      title: o.task.title,
      body: `It's ${formatTime(o.minutes)}`,
      soundName: soundSpec,
      taskId: o.task.id,
      date: o.stateDate,
    });
  }

  wanted.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  // One native call reconciles the whole set: it diffs in memory, re-arms only what changed, and
  // writes its store once. Looping `schedule` here rewrote that store per alarm.
  TaskAlarm.replaceAll(wanted.slice(0, MAX_NATIVE_ALARMS), SNOOZE_SUFFIX);
}

/**
 * Rebuild the whole pending notification set from current state.
 *
 * Cancel-everything-then-reschedule is deliberate: it is idempotent and needs no mapping from
 * occurrence to notification id, so there is no way to leak an orphaned reminder for a task that
 * was edited or deleted.
 */
export async function syncScheduledNotifications(): Promise<number> {
  const now = Date.now();

  // Alarms first, and unconditionally — see syncAlarms.
  syncAlarms(now);

  const settings = useSettingsStore.getState();
  if (!settings.notificationsGranted) return 0;

  await ensureChannels();
  const channels = currentChannelIds();

  const { tasks, occurrences } = useTasksStore.getState();
  const from = todayKey();
  const to = addDays(from, REMINDER_HORIZON_DAYS);

  const reminders: PendingEntry[] = [];

  for (const o of expandRange(tasks, occurrences, from, to, now)) {
    if (o.status === 'done') continue;

    if (o.task.remindersEnabled) {
      for (const offsetMin of REMINDER_OFFSETS_MIN) {
        const fireAt = o.timestamp - offsetMin * 60_000;
        if (fireAt <= now) continue;
        reminders.push({
          fireAt,
          title: o.task.title,
          body: reminderBody(offsetMin, o.minutes),
          channelId: channels.reminder,
          payload: {
            kind: 'reminder',
            taskId: o.task.id,
            date: o.stateDate,
            offsetMin,
          },
        });
      }
    }

    // Expo Go has no custom native code, so there is no foreground-service alarm to fall back on —
    // the best available is a MAX-importance notification at the task time.
    if (o.task.alarmEnabled && !TaskAlarm.available && o.timestamp > now) {
      reminders.push({
        fireAt: o.timestamp,
        title: `⏰ ${o.task.title}`,
        body: `It's ${formatTime(o.minutes)} — tap to open the alarm.`,
        channelId: channels.alarm,
        payload: { kind: 'alarm', taskId: o.task.id, date: o.stateDate },
      });
    }
  }

  const digests: PendingEntry[] = settings.digestsEnabled
    ? buildDigestEntries(now, DIGEST_HORIZON_DAYS).map((d) => ({
        fireAt: d.fireAt,
        title: d.title,
        body: d.body,
        channelId: channels.digest,
        payload:
          d.kind === 'weekly'
            ? { kind: 'weekly', date: d.date }
            : { kind: 'digest', date: d.date, slot: d.slot as 'midday' | 'evening' },
      }))
    : [];

  reminders.sort((a, b) => a.fireAt - b.fireAt);
  digests.sort((a, b) => a.fireAt - b.fireAt);

  const window = [
    ...reminders.slice(0, REMINDER_BUDGET),
    ...digests.slice(0, DIGEST_BUDGET),
  ].sort((a, b) => a.fireAt - b.fireAt);

  // Rebuilding means one native call per entry, and most store changes (tapping Start, editing a
  // note, switching theme) do not alter what should be pending at all. Compare a signature first
  // and skip the churn when nothing moved. Body is part of it because a digest's copy carries a
  // live count that must be allowed to trigger a rebuild.
  const signature = window
    .map((e) => `${e.fireAt}:${e.channelId}:${e.title}:${e.body}`)
    .join('|');
  if (signature === lastSignature) return window.length;

  // Cancel our own pending requests one by one rather than cancelAll(), so a snooze the user just
  // set (scheduled outside this window) survives.
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  for (const request of pending) {
    const payload = parsePayload(request.content.data);
    if (payload?.kind === 'alarm' && payload.snoozed) continue;
    await Notifications.cancelScheduledNotificationAsync(request.identifier);
  }

  for (const entry of window) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: entry.title,
        body: entry.body,
        data: entry.payload,
        // On Android the channel decides the sound; naming it here too covers pre-Oreo.
        ...(isExpoGo ? {} : { sound: true }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(entry.fireAt),
        channelId: entry.channelId,
      },
    });
  }

  lastSignature = signature;
  return window.length;
}

/**
 * Coalesce bursts of mutations (typing in a form, ticking several boxes) into one rebuild, since
 * each rebuild re-schedules the whole pending set.
 */
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
let resyncQueued = false;

export function scheduleSync(delayMs = 600): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void runSync();
  }, delayMs);
}

async function runSync(): Promise<void> {
  if (syncing) {
    resyncQueued = true;
    return;
  }
  syncing = true;
  try {
    await syncScheduledNotifications();
  } catch (err) {
    console.warn('[notifications] sync failed', err);
  } finally {
    syncing = false;
    if (resyncQueued) {
      resyncQueued = false;
      void runSync();
    }
  }
}

/**
 * Re-arm an alarm a few minutes out. Used by both the in-app ringer and the native lock-screen
 * screen, so the two behave identically.
 */
export async function snoozeAlarm(
  taskId: string,
  date: DateKey,
  title: string,
  minutes = 5,
): Promise<void> {
  const settings = useSettingsStore.getState();
  const at = Date.now() + minutes * 60_000;

  if (TaskAlarm.available) {
    TaskAlarm.schedule({
      id: snoozeAlarmId(taskId, date),
      triggerAtMs: at,
      title,
      body: `Snoozed ${minutes} min`,
      soundName: effectiveAlarmSound(settings),
      taskId,
      date,
    });
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `⏰ ${title}`,
      body: `Snoozed ${minutes} min.`,
      data: { kind: 'alarm', taskId, date, snoozed: true } satisfies NotificationPayload,
      ...(isExpoGo ? {} : { sound: true }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(at),
      channelId: currentChannelIds().alarm,
    },
  });
}

export function parsePayload(data: unknown): NotificationPayload | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const date = typeof d.date === 'string' ? d.date : null;
  if (!date) return null;

  switch (d.kind) {
    case 'reminder':
      if (typeof d.taskId !== 'string') return null;
      return {
        kind: 'reminder',
        taskId: d.taskId,
        date,
        offsetMin: typeof d.offsetMin === 'number' ? d.offsetMin : undefined,
      };
    case 'alarm':
      if (typeof d.taskId !== 'string') return null;
      return { kind: 'alarm', taskId: d.taskId, date, snoozed: d.snoozed === true };
    case 'digest':
      return { kind: 'digest', date, slot: d.slot === 'evening' ? 'evening' : 'midday' };
    case 'weekly':
      return { kind: 'weekly', date };
    default:
      return null;
  }
}
