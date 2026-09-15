import React, { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useNotesStore } from '@/store/useNotesStore';
import { useTasksStore } from '@/store/useTasksStore';
import {
  installNotificationHandler,
  invalidateScheduleCache,
  parsePayload,
  requestNotificationPermission,
  scheduleSync,
  snoozeAlarm,
} from '@/lib/notifications';
import { ensureChannels } from '@/lib/channels';
import { Loading } from '@/components/ui';
import TaskAlarm from '../modules/expo-task-alarm';

installNotificationHandler();

function RootNavigator() {
  const t = useTheme();

  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="note/[id]"
          options={{ presentation: 'modal', title: 'Note' }}
        />
        <Stack.Screen
          name="task/[id]"
          options={{ presentation: 'modal', title: 'Task' }}
        />
        <Stack.Screen
          name="alarm"
          options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
        />
      </Stack>
    </>
  );
}

function Bootstrap({ children }: { children: React.ReactNode }) {
  const settingsHydrated = useSettingsStore((s) => s.hydrated);
  const notesHydrated = useNotesStore((s) => s.hydrated);
  const tasksHydrated = useTasksStore((s) => s.hydrated);
  const hydrated = settingsHydrated && notesHydrated && tasksHydrated;

  const bootstrapped = useRef(false);

  // Permission + channels + first schedule, once storage is in.
  useEffect(() => {
    if (!hydrated || bootstrapped.current) return;
    bootstrapped.current = true;

    (async () => {
      await ensureChannels();
      const granted = await requestNotificationPermission();
      useSettingsStore.getState().setNotificationsGranted(granted);
      if (granted) scheduleSync(0);
    })().catch((err) => console.warn('[bootstrap] failed', err));
  }, [hydrated]);

  // The scheduling window is relative to now, so slide it forward whenever the
  // app comes back to the foreground. Drop the signature cache first: Android
  // can discard pending alarms under aggressive battery optimisation, and
  // without this we would trust a cache that says everything is still queued.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      invalidateScheduleCache();
      scheduleSync(250);
    });
    return () => sub.remove();
  }, []);

  // Any task or settings change can invalidate what is scheduled.
  useEffect(() => {
    const unsubTasks = useTasksStore.subscribe(() => scheduleSync());
    const unsubSettings = useSettingsStore.subscribe(() => scheduleSync());
    return () => {
      unsubTasks();
      unsubSettings();
    };
  }, []);

  // Tapping an alarm notification opens the full-screen ringer.
  // Gated on `hydrated` because until then this component renders <Loading />
  // and the navigator does not exist yet — routing into it would be a no-op on
  // the cold-start path, which is exactly when a notification tap launches us.
  useEffect(() => {
    if (!hydrated) return;

    const handle = (response: Notifications.NotificationResponse) => {
      const payload = parsePayload(response.notification.request.content.data);
      if (!payload) return;
      switch (payload.kind) {
        case 'alarm':
          router.push({
            pathname: '/alarm',
            params: { taskId: payload.taskId, date: payload.date },
          });
          break;
        case 'weekly':
          router.navigate('/(tabs)/stats');
          break;
        // A reminder and a daily check-in both point at the day they are about.
        default:
          router.navigate({ pathname: '/(tabs)/tasks', params: { date: payload.date } });
      }
    };

    // Cold start: the tap that launched the app is waiting here. It also
    // survives across launches, so an alarm tapped and dismissed days ago would
    // otherwise re-open the ringer on every subsequent start — only honour it
    // while it is recent enough to still be the reason the app was opened.
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (!r) return;
        const firedAt = r.notification.date;
        if (typeof firedAt === 'number' && Date.now() - firedAt > 10 * 60_000) return;
        handle(r);
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [hydrated]);

  // The native module rings on its own; this only brings the in-app screen
  // forward when the app happens to be open, so "Mark done" is one tap away.
  useEffect(() => {
    if (!hydrated || !TaskAlarm.available) return;

    const ringing = TaskAlarm.addRingingListener((alarm) => {
      if (!alarm?.taskId || !alarm?.date) return;
      router.push({
        pathname: '/alarm',
        params: { taskId: alarm.taskId, date: alarm.date },
      });
    });

    // Snooze on the native lock-screen alarm screen stops the service and emits this. Without a
    // listener it behaved as a second Stop button — nothing re-armed, and the alarm was simply
    // gone. Re-arm here so both snooze buttons mean the same thing.
    const snoozed = TaskAlarm.addSnoozeListener((alarm) => {
      if (!alarm?.taskId || !alarm?.date) return;
      const title = useTasksStore.getState().tasks[alarm.taskId]?.title ?? alarm.title;
      void snoozeAlarm(alarm.taskId, alarm.date, title);
    });

    // Cold start straight into a ringing alarm (the full-screen intent opened
    // the native screen, and the user then tapped through to the app).
    const current = TaskAlarm.ringingAlarm();
    if (current?.taskId && current?.date) {
      router.push({
        pathname: '/alarm',
        params: { taskId: current.taskId, date: current.date },
      });
    }

    return () => {
      ringing.remove();
      snoozed.remove();
    };
  }, [hydrated]);

  if (!hydrated) return <Loading />;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedBackground>
            <Bootstrap>
              <RootNavigator />
            </Bootstrap>
          </ThemedBackground>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedBackground({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ flex: 1, backgroundColor: t.bg }}>{children}</View>;
}
