import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type AlarmInput = {
  /** Stable id — reusing one replaces the alarm it names. */
  id: string;
  triggerAtMs: number;
  title: string;
  body?: string;
  /**
   * Bundled raw-resource filename ('alarm_classic.wav'), or a content:// URI
   * from the device's ringtone picker. Falls back to the system alarm tone.
   */
  soundName?: string | null;
  taskId?: string | null;
  date?: string | null;
};

export type RingingAlarm = {
  id: string;
  triggerAtMs: number;
  title: string;
  body: string;
  taskId: string | null;
  date: string | null;
};

/**
 * A channel created natively rather than through expo-notifications, which can only point a
 * channel at a bundled raw resource. Android channels are immutable once created, so the caller
 * must vary `id` whenever `sound` changes — see lib/channels.ts.
 */
export type ChannelInput = {
  id: string;
  name: string;
  description?: string | null;
  /** Android importance: 4 = HIGH, 5 = MAX. */
  importance?: number;
  /** Raw-resource filename or a content:// URI. Null/omitted means silent. */
  sound?: string | null;
  /** Play on the alarm stream instead of the notification stream. */
  alarmUsage?: boolean;
  vibrate?: boolean;
  vibrationPattern?: number[] | null;
  bypassDnd?: boolean;
};

export type PickedSound = { uri: string; title: string };

type TaskAlarmEvents = {
  onAlarmRinging: (alarm: RingingAlarm) => void;
  onAlarmStopped: (alarm: RingingAlarm) => void;
  onAlarmSnooze: (alarm: RingingAlarm) => void;
};

declare class TaskAlarmNativeModule extends NativeModule<TaskAlarmEvents> {
  schedule(input: AlarmInput): void;
  replaceAll(inputs: AlarmInput[], keepSuffix: string): void;
  cancel(id: string): void;
  cancelAll(): void;
  stopRinging(): void;
  isRinging(): boolean;
  ringingAlarm(): RingingAlarm | null;
  scheduledIds(): string[];
  testRingNow(title: string, soundName: string | null): void;

  createChannel(input: ChannelInput): void;
  channelExists(id: string): boolean;
  channelIds(): string[];
  deleteChannelsExcept(prefixes: string[], keep: string[]): void;

  pickSound(kind: 'alarm' | 'notification', currentUri: string | null): Promise<PickedSound | null>;

  canScheduleExact(): boolean;
  canUseFullScreenIntent(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  openExactAlarmSettings(): void;
  openFullScreenIntentSettings(): void;
  openBatteryOptimizationSettings(): void;
  openNotificationSettings(): void;
}

/**
 * Android-only, and absent in Expo Go (which cannot load custom native code).
 * `requireOptionalNativeModule` returns null there instead of throwing, so the
 * rest of the app keeps working with notification-based alarms.
 */
const native = requireOptionalNativeModule<TaskAlarmNativeModule>('ExpoTaskAlarm');

export const isTaskAlarmAvailable = Platform.OS === 'android' && native != null;

export const TaskAlarm = {
  available: isTaskAlarmAvailable,

  schedule(input: AlarmInput): void {
    native?.schedule(input);
  },
  /**
   * Arm exactly this set, in one pass. Ids ending in `keepSuffix` are left alone — that is how a
   * one-off snooze survives a rebuild it can never be part of.
   */
  replaceAll(inputs: AlarmInput[], keepSuffix: string): void {
    native?.replaceAll(inputs, keepSuffix);
  },
  cancel(id: string): void {
    native?.cancel(id);
  },
  cancelAll(): void {
    native?.cancelAll();
  },
  stopRinging(): void {
    native?.stopRinging();
  },
  isRinging(): boolean {
    return native?.isRinging() ?? false;
  },
  ringingAlarm(): RingingAlarm | null {
    return native?.ringingAlarm() ?? null;
  },
  scheduledIds(): string[] {
    return native?.scheduledIds() ?? [];
  },
  testRingNow(title: string, soundName: string | null): void {
    native?.testRingNow(title, soundName);
  },

  createChannel(input: ChannelInput): void {
    native?.createChannel(input);
  },
  channelExists(id: string): boolean {
    return native?.channelExists(id) ?? false;
  },
  channelIds(): string[] {
    return native?.channelIds() ?? [];
  },
  deleteChannelsExcept(prefixes: string[], keep: string[]): void {
    native?.deleteChannelsExcept(prefixes, keep);
  },

  /** Opens Android's ringtone picker. Resolves null when the user backs out. */
  async pickSound(
    kind: 'alarm' | 'notification',
    currentUri: string | null,
  ): Promise<PickedSound | null> {
    if (!native) return null;
    return native.pickSound(kind, currentUri);
  },

  canScheduleExact(): boolean {
    return native?.canScheduleExact() ?? false;
  },
  canUseFullScreenIntent(): boolean {
    return native?.canUseFullScreenIntent() ?? false;
  },
  isIgnoringBatteryOptimizations(): boolean {
    // Assume fine when there is no native module, so Expo Go shows no false warning.
    return native?.isIgnoringBatteryOptimizations() ?? true;
  },
  openExactAlarmSettings(): void {
    native?.openExactAlarmSettings();
  },
  openFullScreenIntentSettings(): void {
    native?.openFullScreenIntentSettings();
  },
  openBatteryOptimizationSettings(): void {
    native?.openBatteryOptimizationSettings();
  },
  openNotificationSettings(): void {
    native?.openNotificationSettings();
  },

  addRingingListener(fn: (alarm: RingingAlarm) => void) {
    return native?.addListener('onAlarmRinging', fn) ?? { remove: () => {} };
  },
  addStoppedListener(fn: (alarm: RingingAlarm) => void) {
    return native?.addListener('onAlarmStopped', fn) ?? { remove: () => {} };
  },
  addSnoozeListener(fn: (alarm: RingingAlarm) => void) {
    return native?.addListener('onAlarmSnooze', fn) ?? { remove: () => {} };
  },
};

export default TaskAlarm;
