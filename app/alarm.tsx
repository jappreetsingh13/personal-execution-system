import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View, Vibration } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DateKey } from '@/types';
import { useTasksStore } from '@/store/useTasksStore';
import { effectiveAlarmSound, useSettingsStore } from '@/store/useSettingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { Button } from '@/components/ui';
import { tuneSource } from '@/lib/channels';
import { snoozeAlarm } from '@/lib/notifications';
import { formatLongDate, formatTime } from '@/lib/date';
import { occKey } from '@/lib/status';
import TaskAlarm from '../modules/expo-task-alarm';

const SNOOZE_MIN = 5;
const VIBRATION_PATTERN = [0, 700, 400, 700, 400];

export default function AlarmScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { taskId, date } = useLocalSearchParams<{ taskId: string; date: DateKey }>();

  const task = useTasksStore((s) => s.tasks[taskId]);
  const occState = useTasksStore((s) => s.occurrences[occKey(taskId, date)]);
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const alarmTune = useSettingsStore((s) => s.alarmTune);
  const alarmSoundUri = useSettingsStore((s) => s.alarmSoundUri);
  const soundSpec = effectiveAlarmSound({ alarmTune, alarmSoundUri });

  const playerRef = useRef<AudioPlayer | null>(null);
  const [clock, setClock] = useState(() => new Date());

  const minutes = occState?.timeOverride ?? task?.minutes ?? 0;

  /**
   * When the native module is present it owns the ringing (foreground service,
   * lock screen, keeps going with the app closed). This screen must not start a
   * second sound on top of it — it only plays audio itself in the fallback case
   * where there is no native module, i.e. Expo Go.
   */
  const nativeOwnsAudio = TaskAlarm.available;

  /**
   * Stop everything, from every exit path.
   *
   * Previously this relied on unmount cleanup via router.back(), which silently
   * did nothing when the app was cold-started straight onto this screen by a
   * notification tap — there was no route to go back to, so the component never
   * unmounted and the sound kept playing until the app was force-closed. Stop
   * is now explicit and idempotent, and navigation is a separate concern.
   */
  const stopEverything = useCallback(() => {
    Vibration.cancel();
    if (playerRef.current) {
      const player = playerRef.current;
      playerRef.current = null;
      try {
        player.remove();
      } catch {
        // Already torn down — nothing to do.
      }
    }
    TaskAlarm.stopRinging();
  }, []);

  const leave = useCallback(() => {
    stopEverything();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/tasks');
  }, [stopEverything]);

  useEffect(() => {
    let cancelled = false;

    if (!nativeOwnsAudio) {
      (async () => {
        try {
          await setAudioModeAsync({
            playsInSilentMode: true,
            shouldPlayInBackground: false,
            interruptionMode: 'doNotMix',
          });
          if (cancelled) return;
          const player = createAudioPlayer(tuneSource(soundSpec));
          player.loop = true;
          player.volume = 1.0;
          player.play();
          // A stop that landed while we were awaiting must still win.
          if (cancelled) {
            player.remove();
            return;
          }
          playerRef.current = player;
        } catch (err) {
          console.warn('[alarm] playback failed', err);
        }
      })();

      Vibration.vibrate(VIBRATION_PATTERN, true);
    }

    return () => {
      cancelled = true;
      stopEverything();
    };
  }, [soundSpec, nativeOwnsAudio, stopEverything]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeNow = useMemo(
    () =>
      `${clock.getHours() % 12 === 0 ? 12 : clock.getHours() % 12}:${String(
        clock.getMinutes(),
      ).padStart(2, '0')}`,
    [clock],
  );

  const markDone = () => {
    if (task && occState?.status !== 'done') toggleDone(taskId, date);
    leave();
  };

  const snooze = async () => {
    stopEverything();
    // snoozeAlarm picks the native alarm or the notification fallback itself, so this screen and
    // the native lock-screen one cannot drift apart.
    if (task) await snoozeAlarm(taskId, date, task.title, SNOOZE_MIN);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/tasks');
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 28,
        paddingHorizontal: 26,
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, alignItems: 'center', gap: 10, paddingLeft: 44 }}>
          <Text style={{ color: t.textDim, fontSize: 15, fontWeight: '600' }}>{timeNow}</Text>
          <Text style={{ color: t.textFaint, fontSize: 13 }}>{formatLongDate(date)}</Text>
        </View>
        <Pressable
          onPress={leave}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Close alarm"
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.surfaceAlt,
            borderWidth: 1,
            borderColor: t.border,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="close" size={24} color={t.text} />
        </Pressable>
      </View>

      <View style={{ alignItems: 'center', gap: 18 }}>
        <View
          style={{
            width: 116,
            height: 116,
            borderRadius: 58,
            backgroundColor: `${t.accent}26`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="alarm" size={58} color={t.accent} />
        </View>

        <Text
          style={{ color: t.text, fontSize: 27, fontWeight: '800', textAlign: 'center', lineHeight: 34 }}
        >
          {task?.title ?? 'Task alarm'}
        </Text>
        <Text style={{ color: t.accent, fontSize: 19, fontWeight: '700' }}>
          {formatTime(minutes)}
        </Text>
        {task?.details ? (
          <Text style={{ color: t.textDim, fontSize: 14.5, textAlign: 'center', lineHeight: 21 }}>
            {task.details}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 11 }}>
        <Button label="Stop alarm" icon="stop-circle-outline" onPress={leave} />
        <Button
          label="Mark done"
          icon="checkmark-circle-outline"
          variant="secondary"
          onPress={markDone}
        />
        <Button
          label={`Snooze ${SNOOZE_MIN} min`}
          icon="time-outline"
          variant="secondary"
          onPress={() => void snooze()}
        />
      </View>
    </View>
  );
}
