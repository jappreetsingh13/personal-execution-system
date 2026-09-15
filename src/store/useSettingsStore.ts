import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AlarmTune, NotificationTune, ThemeName } from '@/types';

type SettingsState = {
  theme: ThemeName;
  alarmTune: AlarmTune;
  notificationTune: NotificationTune;
  /**
   * A tone chosen from the device's own ringtone library (a content:// URI), which overrides the
   * bundled tune above. Null means "use the bundled tune". The label is kept alongside purely so
   * Settings can name the choice without re-querying Android for it.
   */
  alarmSoundUri: string | null;
  alarmSoundLabel: string | null;
  notificationSoundUri: string | null;
  notificationSoundLabel: string | null;
  /** Daily 1pm / 9:30pm digests and the Monday statistics nudge. */
  digestsEnabled: boolean;
  /** Set once the OS notification permission has been granted. */
  notificationsGranted: boolean;
  /** False until AsyncStorage has been read back — the root layout waits on it. */
  hydrated: boolean;

  setTheme: (theme: ThemeName) => void;
  setAlarmTune: (tune: AlarmTune) => void;
  setNotificationTune: (tune: NotificationTune) => void;
  /** Pass (null, null) to fall back to the bundled tune. */
  setAlarmSound: (uri: string | null, label: string | null) => void;
  setNotificationSound: (uri: string | null, label: string | null) => void;
  setDigestsEnabled: (enabled: boolean) => void;
  setNotificationsGranted: (granted: boolean) => void;
  setHydrated: () => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'daylight',
      alarmTune: 'alarm_classic',
      notificationTune: 'notify_chime',
      alarmSoundUri: null,
      alarmSoundLabel: null,
      notificationSoundUri: null,
      notificationSoundLabel: null,
      digestsEnabled: true,
      notificationsGranted: false,
      hydrated: false,

      setTheme: (theme) => set({ theme }),
      // Picking a bundled tune clears any device override, so the two controls can never
      // disagree about which sound is actually in use.
      setAlarmTune: (alarmTune) =>
        set({ alarmTune, alarmSoundUri: null, alarmSoundLabel: null }),
      setNotificationTune: (notificationTune) =>
        set({ notificationTune, notificationSoundUri: null, notificationSoundLabel: null }),
      setAlarmSound: (alarmSoundUri, alarmSoundLabel) => set({ alarmSoundUri, alarmSoundLabel }),
      setNotificationSound: (notificationSoundUri, notificationSoundLabel) =>
        set({ notificationSoundUri, notificationSoundLabel }),
      setDigestsEnabled: (digestsEnabled) => set({ digestsEnabled }),
      setNotificationsGranted: (notificationsGranted) => set({ notificationsGranted }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'todos.settings.v1',
      storage: createJSONStorage(() => AsyncStorage),
      // `hydrated` is runtime-only — persisting it would defeat the gate.
      partialize: ({
        theme,
        alarmTune,
        notificationTune,
        alarmSoundUri,
        alarmSoundLabel,
        notificationSoundUri,
        notificationSoundLabel,
        digestsEnabled,
        notificationsGranted,
      }) => ({
        theme,
        alarmTune,
        notificationTune,
        alarmSoundUri,
        alarmSoundLabel,
        notificationSoundUri,
        notificationSoundLabel,
        digestsEnabled,
        notificationsGranted,
      }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

/** The sound spec actually handed to the native layer: device override, else bundled tune. */
export function effectiveAlarmSound(s: {
  alarmTune: AlarmTune;
  alarmSoundUri: string | null;
}): string {
  return s.alarmSoundUri ?? `${s.alarmTune}.wav`;
}

export function effectiveNotificationSound(s: {
  notificationTune: NotificationTune;
  notificationSoundUri: string | null;
}): string {
  return s.notificationSoundUri ?? `${s.notificationTune}.wav`;
}
