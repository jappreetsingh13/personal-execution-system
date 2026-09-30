import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  effectiveAlarmSound,
  effectiveNotificationSound,
  useSettingsStore,
} from '@/store/useSettingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { THEME_LIST } from '@/theme/themes';
import { Button, Card, SectionTitle } from '@/components/ui';
import { TabHeader } from '@/components/TabHeader';
import {
  ALARM_TUNES,
  NOTIFICATION_TUNES,
  ensureChannels,
  isExpoGo,
  pickDeviceSound,
  tuneSource,
} from '@/lib/channels';
import { invalidateScheduleCache, scheduleSync } from '@/lib/notifications';
import { StreakWidget } from '../../modules/expo-widget';
import TaskAlarm from '../../modules/expo-task-alarm';

/** How long a preview plays before stopping itself. Alarm tunes run ~27s; nobody needs all of it. */
const PREVIEW_MS = 6000;

/**
 * Set once, not per preview.
 *
 * Doing this inside the tap handler was the bug: it is async, and the player was only assigned to
 * the ref *after* awaiting it, so a second tap landing during that window created a second player
 * and orphaned the first with no handle to stop it. That is why sounds stacked and only closing the
 * app silenced them.
 */
let audioModeReady: Promise<void> | null = null;
function ensureAudioMode(): Promise<void> {
  audioModeReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'mixWithOthers',
  }).catch(() => {});
  return audioModeReady;
}

export default function SettingsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const alarmTune = useSettingsStore((s) => s.alarmTune);
  const setAlarmTune = useSettingsStore((s) => s.setAlarmTune);
  const notificationTune = useSettingsStore((s) => s.notificationTune);
  const setNotificationTune = useSettingsStore((s) => s.setNotificationTune);
  const alarmSoundUri = useSettingsStore((s) => s.alarmSoundUri);
  const alarmSoundLabel = useSettingsStore((s) => s.alarmSoundLabel);
  const notificationSoundUri = useSettingsStore((s) => s.notificationSoundUri);
  const notificationSoundLabel = useSettingsStore((s) => s.notificationSoundLabel);
  const setAlarmSound = useSettingsStore((s) => s.setAlarmSound);
  const setNotificationSound = useSettingsStore((s) => s.setNotificationSound);
  const digestsEnabled = useSettingsStore((s) => s.digestsEnabled);
  const setDigestsEnabled = useSettingsStore((s) => s.setDigestsEnabled);

  // Re-read on focus: a widget can be added or removed only while this app is
  // in the background (the pin dialog is the one exception).
  const [widgetAdded, setWidgetAdded] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (StreakWidget.available) setWidgetAdded(StreakWidget.isAdded());
    }, []),
  );

  const [previewing, setPreviewing] = useState<string | null>(null);

  /**
   * Every player ever created by this screen, so teardown can never miss one — even a player whose
   * creation was still in flight when the user moved on.
   */
  const players = useRef(new Set<AudioPlayer>()).current;
  /** Claimed synchronously before any await, so a superseded preview can identify itself. */
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseAll = useCallback(() => {
    for (const player of players) {
      try {
        player.pause();
      } catch {
        // Already stopped.
      }
      try {
        player.remove();
      } catch {
        // Already released.
      }
    }
    players.clear();
  }, [players]);

  const stopPreview = useCallback(() => {
    generation.current += 1;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    releaseAll();
    setPreviewing(null);
  }, [releaseAll]);

  // A preview must not outlive this screen: stop it when the tab loses focus, when the app is
  // backgrounded, and on unmount.
  useFocusEffect(useCallback(() => () => stopPreview(), [stopPreview]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stopPreview();
    });
    return () => {
      sub.remove();
      stopPreview();
    };
  }, [stopPreview]);

  const preview = useCallback(
    (key: string, spec: string) => {
      // Tapping the one that is already playing acts as stop.
      if (previewing === key) {
        stopPreview();
        return;
      }

      stopPreview();
      const mine = generation.current;
      setPreviewing(key);

      void (async () => {
        await ensureAudioMode();
        // Someone tapped again (or left) while the audio mode was settling — do not start.
        if (generation.current !== mine) return;

        try {
          const player = createAudioPlayer(tuneSource(spec));
          if (generation.current !== mine) {
            player.remove();
            return;
          }
          players.add(player);
          player.volume = 1;
          player.play();

          timer.current = setTimeout(() => {
            if (generation.current === mine) stopPreview();
          }, PREVIEW_MS);
        } catch (err) {
          console.warn('[settings] preview failed', err);
          if (generation.current === mine) stopPreview();
        }
      })();
    },
    [previewing, stopPreview, players],
  );

  // ---- Device sound picker ------------------------------------------------

  const chooseDeviceSound = useCallback(
    (kind: 'alarm' | 'notification') => {
      stopPreview();
      void (async () => {
        try {
          const label = await pickDeviceSound(kind);
          if (!label) return;
          // A new sound means a new channel id, so the pending set has to be rebuilt against it.
          invalidateScheduleCache();
          scheduleSync(0);
        } catch (err) {
          console.warn('[settings] sound picker failed', err);
          Alert.alert('Could not open the picker', 'This device did not offer a sound picker.');
        }
      })();
    },
    [stopPreview],
  );

  const clearDeviceSound = useCallback(
    (kind: 'alarm' | 'notification') => {
      stopPreview();
      if (kind === 'alarm') setAlarmSound(null, null);
      else setNotificationSound(null, null);
      void ensureChannels().then(() => {
        invalidateScheduleCache();
        scheduleSync(0);
      });
    },
    [stopPreview, setAlarmSound, setNotificationSound],
  );

  // ---- Reliability diagnostics -------------------------------------------

  const alarmReady = TaskAlarm.available;
  const [diagnostics, setDiagnostics] = useState({
    exact: true,
    fullScreen: true,
    battery: true,
  });

  // Re-read on focus rather than only at first render: these are granted in system settings, so
  // the app is always in the background at the moment they change.
  useFocusEffect(
    useCallback(() => {
      if (!alarmReady) return;
      setDiagnostics({
        exact: TaskAlarm.canScheduleExact(),
        fullScreen: TaskAlarm.canUseFullScreenIntent(),
        battery: TaskAlarm.isIgnoringBatteryOptimizations(),
      });
    }, [alarmReady]),
  );

  const allGood = diagnostics.exact && diagnostics.fullScreen && diagnostics.battery;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TabHeader title="Settings" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90, gap: 24 }}
      >
      {/* ---- Theme ---- */}
      <View style={{ gap: 12 }}>
        <SectionTitle>Theme</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {THEME_LIST.map((item) => (
            <ThemeCard
              key={item.name}
              label={item.label}
              swatch={item.swatch}
              selected={item.name === theme}
              onPress={() => setTheme(item.name)}
            />
          ))}
        </View>
      </View>

      {/* ---- Alarm sound ---- */}
      <View style={{ gap: 12 }}>
        <SectionTitle>Alarm sound</SectionTitle>
        <Card style={{ overflow: 'hidden' }}>
          {ALARM_TUNES.map((tune, i) => (
            <TuneRow
              key={tune.id}
              label={tune.label}
              selected={!alarmSoundUri && tune.id === alarmTune}
              playing={previewing === `alarm:${tune.id}`}
              first={i === 0}
              onSelect={() => setAlarmTune(tune.id)}
              onPreview={() => preview(`alarm:${tune.id}`, `${tune.id}.wav`)}
            />
          ))}
          {alarmReady ? (
            <DeviceSoundRow
              label={alarmSoundLabel}
              selected={!!alarmSoundUri}
              playing={previewing === 'alarm:device'}
              onChoose={() => chooseDeviceSound('alarm')}
              onClear={() => clearDeviceSound('alarm')}
              onPreview={
                alarmSoundUri ? () => preview('alarm:device', alarmSoundUri) : undefined
              }
            />
          ) : null}
        </Card>

        {alarmReady ? (
          <Button
            label="Test alarm now"
            icon="alarm-outline"
            variant="secondary"
            onPress={() => {
              stopPreview();
              TaskAlarm.testRingNow('Test alarm', effectiveAlarmSound(useSettingsStore.getState()));
            }}
          />
        ) : null}

        <Text style={{ color: t.textDim, fontSize: 12.5, lineHeight: 18 }}>
          {alarmReady
            ? 'Alarms ring on the lock screen and keep ringing until you stop them, even with the app closed.'
            : 'Full alarms need the installed app — in Expo Go this falls back to a notification sound.'}
        </Text>
      </View>

      {/* ---- Notification sound ---- */}
      <View style={{ gap: 12 }}>
        <SectionTitle>Notification sound</SectionTitle>
        <Card style={{ overflow: 'hidden' }}>
          {NOTIFICATION_TUNES.map((tune, i) => (
            <TuneRow
              key={tune.id}
              label={tune.label}
              selected={!notificationSoundUri && tune.id === notificationTune}
              playing={previewing === `notify:${tune.id}`}
              first={i === 0}
              onSelect={() => setNotificationTune(tune.id)}
              onPreview={() => preview(`notify:${tune.id}`, `${tune.id}.wav`)}
            />
          ))}
          {alarmReady ? (
            <DeviceSoundRow
              label={notificationSoundLabel}
              selected={!!notificationSoundUri}
              playing={previewing === 'notify:device'}
              onChoose={() => chooseDeviceSound('notification')}
              onClear={() => clearDeviceSound('notification')}
              onPreview={
                notificationSoundUri
                  ? () => preview('notify:device', notificationSoundUri)
                  : undefined
              }
            />
          ) : null}
        </Card>
        <Text style={{ color: t.textDim, fontSize: 12.5, lineHeight: 18 }}>
          Used for the 30-minute and 5-minute reminders, and the daily summary.
        </Text>
      </View>

      {/* ---- Daily summary ---- */}
      <View style={{ gap: 12 }}>
        <SectionTitle>Daily summary</SectionTitle>
        <Card style={{ paddingHorizontal: 15 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}
          >
            <Ionicons name="sunny-outline" size={20} color={t.textDim} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 15.5, fontWeight: '600' }}>
                Check in twice a day
              </Text>
              <Text style={{ color: t.textDim, fontSize: 12.5, marginTop: 2 }}>
                1:00 PM and 9:30 PM, plus your week in review on Monday morning
              </Text>
            </View>
            <Switch
              value={digestsEnabled}
              onValueChange={setDigestsEnabled}
              trackColor={{ true: t.accent, false: t.border }}
              thumbColor="#FFFFFF"
            />
          </View>
        </Card>
      </View>

      {/* ---- Home screen widget ---- */}
      {StreakWidget.available ? (
        <View style={{ gap: 12 }}>
          <SectionTitle>Home screen widget</SectionTitle>
          <Card style={{ padding: 14, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="flame-outline" size={20} color={t.accent} />
              <Text style={{ flex: 1, color: t.text, fontSize: 15.5, fontWeight: '600' }}>
                Streak widget
              </Text>
              {widgetAdded ? (
                <Ionicons name="checkmark-circle" size={19} color={t.accent} />
              ) : null}
            </View>
            <Text style={{ color: t.textDim, fontSize: 12.5, lineHeight: 18 }}>
              A flame, your day streak, and today's progress — with a fresh nudge every 4 hours to
              pull you back in.
            </Text>
            {widgetAdded ? (
              <Text style={{ color: t.textDim, fontSize: 12.5, lineHeight: 18 }}>
                It's on your home screen. Removed it by mistake? Use the manual path below — the
                widget can only be added once.
              </Text>
            ) : (
              <Button
                label="Add widget to home screen"
                icon="add-circle-outline"
                onPress={() => {
                  if (!StreakWidget.requestPin()) {
                    Alert.alert(
                      'Add it manually',
                      'Long-press an empty spot on your home screen, open Widgets, find Todos, and drag the streak widget out.',
                    );
                  }
                }}
              />
            )}
            <Text style={{ color: t.textFaint, fontSize: 12, lineHeight: 17 }}>
              If the button does nothing on your phone: long-press the home screen → Widgets →
              Todos, then drag the streak widget out.
            </Text>
          </Card>
        </View>
      ) : null}

      {/* ---- Alarm reliability ---- */}
      {alarmReady ? (
        <View style={{ gap: 12 }}>
          <SectionTitle>Alarm reliability</SectionTitle>

          {allGood ? (
            <Card style={{ padding: 14, flexDirection: 'row', gap: 11, alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={20} color={t.accent} />
              <Text style={{ flex: 1, color: t.textDim, fontSize: 13, lineHeight: 18 }}>
                Everything alarms need is granted. They will ring on time with the app closed.
              </Text>
            </Card>
          ) : null}

          {!diagnostics.exact ? (
            <PermissionCard
              title="Exact alarms are off"
              body="Without this Android may delay an alarm by several minutes, or skip it while the phone is idle."
              action="Allow exact alarms"
              onPress={() => TaskAlarm.openExactAlarmSettings()}
            />
          ) : null}

          {!diagnostics.fullScreen ? (
            <PermissionCard
              title="Full-screen alarms are off"
              body="The alarm still rings, but it shows as a notification instead of taking over the lock screen."
              action="Allow full-screen alarms"
              onPress={() => TaskAlarm.openFullScreenIntentSettings()}
            />
          ) : null}

          {!diagnostics.battery ? (
            <PermissionCard
              title="Battery optimisation is on"
              body="This is the most common reason an alarm fires late or not at all. Allowing unrestricted background use fixes it."
              action="Allow unrestricted battery use"
              onPress={() => TaskAlarm.openBatteryOptimizationSettings()}
            />
          ) : null}

          <Button
            label="Open notification settings"
            icon="options-outline"
            variant="secondary"
            onPress={() => TaskAlarm.openNotificationSettings()}
          />
          <Text style={{ color: t.textDim, fontSize: 12.5, lineHeight: 18 }}>
            If reminders arrive silently, check the channel here has not been muted in Android.
          </Text>
        </View>
      ) : null}

      {isExpoGo ? (
        <Card style={{ padding: 14, flexDirection: 'row', gap: 11 }}>
          <Ionicons name="information-circle-outline" size={20} color={t.accent} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>
              Running in Expo Go
            </Text>
            <Text style={{ color: t.textDim, fontSize: 12.5, lineHeight: 18 }}>
              Custom sounds, device tones and true lock-screen alarms need the installed app. Your
              choices are saved either way.
            </Text>
          </View>
        </Card>
      ) : null}
      </ScrollView>
    </View>
  );
}

function PermissionCard({
  title,
  body,
  action,
  onPress,
}: {
  title: string;
  body: string;
  action: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Card style={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="alert-circle" size={18} color={t.danger} />
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 14, flex: 1 }}>{title}</Text>
      </View>
      <Text style={{ color: t.textDim, fontSize: 12.5, lineHeight: 18 }}>{body}</Text>
      <Button label={action} variant="secondary" onPress={onPress} />
    </Card>
  );
}

function ThemeCard({
  label,
  swatch,
  selected,
  onPress,
}: {
  label: string;
  swatch: [string, string];
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} theme`}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: '45%',
        borderRadius: 14,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.accent : t.border,
        backgroundColor: t.surface,
        overflow: 'hidden',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ height: 62, flexDirection: 'row' }}>
        <View style={{ flex: 1, backgroundColor: swatch[0] }} />
        <View style={{ flex: 1, backgroundColor: swatch[1] }} />
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 11,
        }}
      >
        <Text style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: '700' }}>{label}</Text>
        {selected ? <Ionicons name="checkmark-circle" size={19} color={t.accent} /> : null}
      </View>
    </Pressable>
  );
}

function TuneRow({
  label,
  selected,
  playing,
  first,
  onSelect,
  onPreview,
}: {
  label: string;
  selected: boolean;
  playing: boolean;
  first: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.border,
      }}
    >
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          paddingVertical: 15,
          paddingLeft: 15,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={selected ? t.accent : t.textFaint}
        />
        <Text style={{ color: t.text, fontSize: 15.5, fontWeight: '600' }}>{label}</Text>
      </Pressable>
      <Pressable
        onPress={onPreview}
        hitSlop={8}
        accessibilityLabel={playing ? `Stop ${label}` : `Preview ${label}`}
        style={({ pressed }) => ({
          paddingHorizontal: 16,
          paddingVertical: 15,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons
          name={playing ? 'stop-circle' : 'play-circle-outline'}
          size={23}
          color={playing ? t.accent : t.textDim}
        />
      </Pressable>
    </View>
  );
}

function DeviceSoundRow({
  label,
  selected,
  playing,
  onChoose,
  onClear,
  onPreview,
}: {
  label: string | null;
  selected: boolean;
  playing: boolean;
  onChoose: () => void;
  onClear: () => void;
  onPreview?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: t.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          onPress={onChoose}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
            paddingVertical: 15,
            paddingLeft: 15,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons
            name={selected ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selected ? t.accent : t.textFaint}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 15.5, fontWeight: '600' }}>
              {selected && label ? label : 'From my phone'}
            </Text>
            <Text style={{ color: t.textDim, fontSize: 12.5, marginTop: 2 }}>
              {selected ? 'Tap to choose a different tone' : 'Pick any tone on this device'}
            </Text>
          </View>
        </Pressable>

        {selected && onPreview ? (
          <Pressable
            onPress={onPreview}
            hitSlop={8}
            accessibilityLabel={playing ? 'Stop preview' : 'Preview device sound'}
            style={({ pressed }) => ({
              paddingHorizontal: 10,
              paddingVertical: 15,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons
              name={playing ? 'stop-circle' : 'play-circle-outline'}
              size={23}
              color={playing ? t.accent : t.textDim}
            />
          </Pressable>
        ) : null}

        {selected ? (
          <Pressable
            onPress={onClear}
            hitSlop={8}
            accessibilityLabel="Use a bundled tune instead"
            style={({ pressed }) => ({
              paddingRight: 15,
              paddingLeft: 4,
              paddingVertical: 15,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="close-circle" size={19} color={t.textFaint} />
          </Pressable>
        ) : (
          <Ionicons
            name="chevron-forward"
            size={17}
            color={t.textFaint}
            style={{ marginRight: 16 }}
          />
        )}
      </View>
    </View>
  );
}
