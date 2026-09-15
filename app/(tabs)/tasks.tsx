import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DateKey, Importance, Occurrence } from '@/types';
import { useTasksStore } from '@/store/useTasksStore';
import { useNotesStore } from '@/store/useNotesStore';
import { useTheme } from '@/theme/ThemeProvider';
import { DateStrip } from '@/components/DateStrip';
import { DayTimeline } from '@/components/DayTimeline';
import { ImportanceFilter } from '@/components/ImportanceFilter';
import { Sheet } from '@/components/Sheet';
import { useShareSheet } from '@/components/ShareSheet';
import { EmptyState, Fab } from '@/components/ui';
import { STATUS_COLORS } from '@/theme/themes';
import { addDays, formatDayHeading, formatRelativeDay, fromKey, todayKey, toKey } from '@/lib/date';
import { taskDoc } from '@/lib/export';
import { useDayOccurrences, useMarkedDates, useNow } from '@/lib/useOccurrences';

export default function TasksScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ date?: string }>();
  const now = useNow();

  const [selected, setSelected] = useState<DateKey>(params.date ?? todayKey());
  const [showPicker, setShowPicker] = useState(false);
  const [levels, setLevels] = useState<Set<Importance>>(new Set());

  React.useEffect(() => {
    if (params.date) setSelected(params.date);
  }, [params.date]);

  const toggleDone = useTasksStore((s) => s.toggleDone);
  const toggleStarted = useTasksStore((s) => s.toggleStarted);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const moveOccurrence = useTasksStore((s) => s.moveOccurrence);
  const unlinkTask = useNotesStore((s) => s.unlinkTask);
  const notes = useNotesStore((s) => s.notes);

  const all = useDayOccurrences(selected, now);
  const occurrences = useMemo(
    () => (levels.size === 0 ? all : all.filter((o) => levels.has(o.task.importance))),
    [all, levels],
  );

  const today = todayKey();
  const markedDates = useMarkedDates(addDays(today, -30), addDays(today, 60));

  const counts = useMemo(() => {
    const done = occurrences.filter((o) => o.status === 'done').length;
    return { done, total: occurrences.length };
  }, [occurrences]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Tasks',
      headerRight: () => (
        <Pressable
          onPress={() => setShowPicker(true)}
          hitSlop={10}
          style={{ marginRight: 16 }}
          accessibilityLabel="Open calendar"
        >
          <Ionicons name="calendar-outline" size={22} color={t.accent} />
        </Pressable>
      ),
    });
  }, [navigation, t]);

  const openTask = (o: Occurrence) =>
    router.push({ pathname: '/task/[id]', params: { id: o.task.id, date: o.stateDate } });

  const share = useShareSheet();
  const [menu, setMenu] = useState<Occurrence | null>(null);

  const confirmDelete = (o: Occurrence) => {
    Alert.alert(
      'Delete task',
      `Delete "${o.task.title}" and all its history? Once deleted it's gone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            unlinkTask(o.task.id);
            deleteTask(o.task.id);
          },
        },
      ],
    );
  };

  const onLongPress = (o: Occurrence) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenu(o);
  };

  const isToday = selected === today;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <DateStrip selected={selected} onSelect={setSelected} markedDates={markedDates} />

      <View style={{ paddingTop: 12, paddingBottom: 10 }}>
        <ImportanceFilter selected={levels} onChange={setLevels} />
      </View>

      <View
        style={{
          paddingHorizontal: 16,
          paddingBottom: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '800' }}>
            {formatDayHeading(selected)}
          </Text>
          <Text style={{ color: t.textDim, fontSize: 13, marginTop: 2 }}>
            {counts.total === 0 ? 'Nothing scheduled' : `${counts.done} of ${counts.total} done`}
          </Text>
        </View>
        {!isToday ? (
          <Pressable
            onPress={() => setSelected(today)}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 9,
              borderWidth: 1,
              borderColor: t.accent,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: t.accent, fontSize: 12.5, fontWeight: '700' }}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      {counts.total > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
            <View
              style={{
                width: `${(counts.done / counts.total) * 100}%`,
                height: '100%',
                backgroundColor: STATUS_COLORS.done,
              }}
            />
          </View>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
        {occurrences.length === 0 ? (
          <EmptyState
            icon="checkbox-outline"
            title={levels.size > 0 ? 'Nothing at this importance' : 'No tasks this day'}
            subtitle={
              levels.size > 0
                ? 'Clear the filter to see the rest of the day.'
                : 'Tap + to add one. You can set it for today only, or repeat it Mon–Fri, every other day, or on dates you pick.'
            }
          />
        ) : (
          <DayTimeline
            occurrences={occurrences}
            now={now}
            onPressTask={openTask}
            onLongPressTask={onLongPress}
            onToggleDone={(o) => toggleDone(o.task.id, o.stateDate)}
            onToggleStarted={(o) => toggleStarted(o.task.id, o.stateDate)}
          />
        )}
      </ScrollView>

      {showPicker ? (
        <DateTimePicker
          value={fromKey(selected)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(event, date) => {
            setShowPicker(false);
            if (event.type === 'set' && date) setSelected(toKey(date));
          }}
        />
      ) : null}

      <Fab
        onPress={() => router.push({ pathname: '/task/[id]', params: { id: 'new', date: selected } })}
      />

      <Sheet
        visible={menu != null}
        title={menu?.task.title}
        subtitle={menu ? `${formatRelativeDay(menu.date)} · ${formatDayHeading(menu.date)}` : undefined}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                {
                  label: 'Share',
                  hint: 'As text, PDF or Word',
                  icon: 'share-outline',
                  onPress: () => share.open(taskDoc(menu.task, notes)),
                },
                {
                  label: 'Shift to tomorrow',
                  hint: `Moves this day only — ${formatRelativeDay(addDays(menu.date, 1))}`,
                  icon: 'arrow-forward-circle-outline',
                  onPress: () => moveOccurrence(menu.task.id, menu.stateDate, addDays(menu.date, 1)),
                },
                {
                  label: menu.status === 'done' ? 'Mark not done' : 'Mark done',
                  icon: 'checkmark-circle-outline',
                  onPress: () => toggleDone(menu.task.id, menu.stateDate),
                },
                {
                  label: 'Delete task',
                  hint: 'Removes every day, past and future',
                  icon: 'trash-outline',
                  destructive: true,
                  onPress: () => confirmDelete(menu),
                },
              ]
            : []
        }
      />

      {share.element}
    </View>
  );
}
