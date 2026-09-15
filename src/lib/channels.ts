import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import type { AlarmTune, NotificationTune } from '@/types';
import {
  effectiveAlarmSound,
  effectiveNotificationSound,
  useSettingsStore,
} from '@/store/useSettingsStore';
import TaskAlarm from '../../modules/expo-task-alarm';

/**
 * Expo Go cannot carry the bundled tunes: channel sounds must exist as native raw resources, which
 * only the `expo-notifications` config plugin can produce, and config plugins do not apply in Expo
 * Go. So we create the same channels either way but omit `sound` there, letting Android use its
 * default rather than pointing at a resource that does not exist.
 *
 * `appOwnership` is deprecated in favour of `executionEnvironment`, but it is used deliberately
 * here: `executionEnvironment` reports 'storeClient' for BOTH Expo Go and an expo-dev-client
 * development build, so it cannot tell them apart — and testing against it silently stripped the
 * sound from every channel in the dev build. `appOwnership` is 'expo' in Expo Go and null
 * everywhere else, which is exactly the distinction we need.
 */
export const isExpoGo = Constants.appOwnership === 'expo';

/**
 * Android notification channels are IMMUTABLE once created — re-creating one with a different
 * sound is silently ignored. Two things follow, and both are load-bearing:
 *
 *  1. The channel id embeds a hash of the sound, so choosing a new tone always creates a NEW
 *     channel rather than quietly doing nothing. This is what makes the device-sound picker work.
 *  2. VERSION is a manual escape hatch for changing anything else about a channel.
 *
 * v1 -> v2: v1 channels were created silent because of an isExpoGo bug.
 * v2 -> v3: channel sounds moved from expo-notifications (raw resources only) to the native module
 *           (any Uri), and ids became sound-addressed. v2 channels can carry a sound the user
 *           muted or an override that never applied, and neither can be repaired in place.
 */
const VERSION = 'v3';

/** Prefixes owned by this module — used to sweep away channels from superseded sound choices. */
const CHANNEL_PREFIXES = ['reminder-', 'digest-', 'alarm-'];

export const ALARM_TUNES: { id: AlarmTune; label: string; asset: number }[] = [
  {
    id: 'alarm_classic',
    label: 'Classic',
    asset: require('../../assets/sounds/alarm_classic.wav'),
  },
  {
    id: 'alarm_pulse',
    label: 'Pulse',
    asset: require('../../assets/sounds/alarm_pulse.wav'),
  },
];

export const NOTIFICATION_TUNES: { id: NotificationTune; label: string; asset: number }[] = [
  {
    id: 'notify_chime',
    label: 'Chime',
    asset: require('../../assets/sounds/notify_chime.wav'),
  },
  {
    id: 'notify_ping',
    label: 'Ping',
    asset: require('../../assets/sounds/notify_ping.wav'),
  },
];

/**
 * Short stable hash (djb2) of a sound spec. A content:// URI is far too long and contains
 * characters that do not belong in a channel id; this keeps ids short, legal and deterministic.
 */
function hashSpec(spec: string): string {
  let h = 5381;
  for (let i = 0; i < spec.length; i++) {
    h = ((h << 5) + h + spec.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export function reminderChannelId(spec: string): string {
  return `reminder-${VERSION}-${hashSpec(spec)}`;
}

export function digestChannelId(spec: string): string {
  return `digest-${VERSION}-${hashSpec(spec)}`;
}

export function alarmChannelId(spec: string): string {
  return `alarm-${VERSION}-${hashSpec(spec)}`;
}

/** The channel ids implied by the current settings. */
export function currentChannelIds(): {
  reminder: string;
  digest: string;
  alarm: string;
  notificationSpec: string;
  alarmSpec: string;
} {
  const s = useSettingsStore.getState();
  const notificationSpec = effectiveNotificationSound(s);
  const alarmSpec = effectiveAlarmSound(s);
  return {
    reminder: reminderChannelId(notificationSpec),
    digest: digestChannelId(notificationSpec),
    alarm: alarmChannelId(alarmSpec),
    notificationSpec,
    alarmSpec,
  };
}

/** Playable source for the in-app preview: a bundled asset, or a device URI. */
export function tuneSource(spec: string): number | { uri: string } {
  if (spec.startsWith('content://') || spec.startsWith('file://')) return { uri: spec };
  const all = [...ALARM_TUNES, ...NOTIFICATION_TUNES];
  const match = all.find((t) => `${t.id}.wav` === spec || t.id === spec);
  return (match ?? ALARM_TUNES[0]).asset;
}

export function tuneAsset(id: AlarmTune | NotificationTune): number {
  const all = [...ALARM_TUNES, ...NOTIFICATION_TUNES];
  return (all.find((t) => t.id === id) ?? ALARM_TUNES[0]).asset;
}

const VIBRATION_REMINDER = [0, 220, 120, 220];
const VIBRATION_ALARM = [0, 600, 300, 600, 300, 600];

/**
 * Create the channels implied by current settings.
 *
 * Cheap and idempotent, so it just runs at startup and before every schedule rather than tracking
 * which already exist. On a real build the native module does the work, because expo-notifications
 * can only point a channel at a bundled raw resource and would drop a device-picked tone.
 */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const { reminder, digest, alarm, notificationSpec } = currentChannelIds();

  if (TaskAlarm.available) {
    TaskAlarm.createChannel({
      id: reminder,
      name: 'Task reminders',
      description: 'Heads-up 30 minutes and 5 minutes before a task.',
      importance: 4,
      sound: notificationSpec,
      vibrate: true,
      vibrationPattern: VIBRATION_REMINDER,
    });

    TaskAlarm.createChannel({
      id: digest,
      name: 'Daily summary',
      description: 'Your midday and evening check-ins, and the Monday statistics nudge.',
      importance: 4,
      sound: notificationSpec,
      vibrate: true,
      vibrationPattern: VIBRATION_REMINDER,
    });

    // The alarm channel only matters where the native alarm is unavailable; a real build rings
    // through AlarmService, which owns its own silent channel and plays the audio itself.
    TaskAlarm.deleteChannelsExcept(CHANNEL_PREFIXES, [reminder, digest]);
    return;
  }

  // Expo Go: no custom native code, so no custom sounds either.
  await Notifications.setNotificationChannelAsync(reminder, {
    name: 'Task reminders',
    description: 'Heads-up 30 minutes and 5 minutes before a task.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: VIBRATION_REMINDER,
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync(digest, {
    name: 'Daily summary',
    description: 'Your midday and evening check-ins, and the Monday statistics nudge.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: VIBRATION_REMINDER,
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync(alarm, {
    name: 'Task alarms',
    description: 'Rings at the exact task time when an alarm is switched on.',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: VIBRATION_ALARM,
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Open Android's ringtone picker and remember the choice.
 *
 * Returns the chosen label, or null if the user backed out. The caller is responsible for
 * re-running `ensureChannels`, since a new sound means a new channel.
 */
export async function pickDeviceSound(kind: 'alarm' | 'notification'): Promise<string | null> {
  if (!TaskAlarm.available) return null;
  const s = useSettingsStore.getState();
  const current = kind === 'alarm' ? s.alarmSoundUri : s.notificationSoundUri;

  const picked = await TaskAlarm.pickSound(kind, current);
  if (!picked) return null;

  if (kind === 'alarm') s.setAlarmSound(picked.uri, picked.title);
  else s.setNotificationSound(picked.uri, picked.title);

  await ensureChannels();
  return picked.title;
}
