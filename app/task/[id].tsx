import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DateKey, Importance, Recurrence, Section } from '@/types';
import { emptyTaskDraft, useTasksStore, type TaskDraft } from '@/store/useTasksStore';
import { useNotesStore } from '@/store/useNotesStore';
import { useTheme } from '@/theme/ThemeProvider';
import { OVERDUE_COLOR, STATUS_COLORS, STATUS_LABELS } from '@/theme/themes';
import { ColorPicker } from '@/components/ColorPicker';
import { LinkPicker, type LinkOption } from '@/components/LinkPicker';
import { SectionsEditor } from '@/components/Sections';
import { useShareSheet } from '@/components/ShareSheet';
import { Button, Card, Field, SectionTitle } from '@/components/ui';
import { taskDoc } from '@/lib/export';
import { defaultContextDate } from '@/lib/recurrence';
import {
  addDays,
  formatLongDate,
  formatRelativeDay,
  formatTime,
  fromKey,
  timestampFor,
  todayKey,
  toKey,
  WEEKDAY_NAMES,
} from '@/lib/date';
import { occKey, resolveStatus } from '@/lib/status';

type RecurrenceKind = Recurrence['kind'];

const RECURRENCE_OPTIONS: { kind: RecurrenceKind; label: string }[] = [
  { kind: 'once', label: 'One time' },
  { kind: 'daily', label: 'Every day' },
  { kind: 'weekdays', label: 'Pick days' },
  { kind: 'alternate', label: 'Alternate' },
  { kind: 'custom', label: 'Custom dates' },
];

export default function TaskEditor() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const isNew = id === 'new';

  const task = useTasksStore((s) => (isNew ? undefined : s.tasks[id]));

  /**
   * Whether the caller named a day. A task opened from the day view always does; one opened from a
   * note's linked-task chip used to not, and silently fell back to today — which for a task that
   * ran yesterday reads back as Not Started and Overdue instead of the Done that is actually
   * recorded. When no day is named, pick the one the task is really about.
   */
  const hasExplicitDate = typeof date === 'string' && date.length > 0;
  const contextDate: DateKey = useMemo(() => {
    if (hasExplicitDate) return date;
    if (task) return defaultContextDate(task);
    return todayKey();
  }, [hasExplicitDate, date, task]);

  const occState = useTasksStore((s) =>
    isNew ? undefined : s.occurrences[occKey(id, contextDate)],
  );
  const addTask = useTasksStore((s) => s.addTask);
  const updateTask = useTasksStore((s) => s.updateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const setTimeOverride = useTasksStore((s) => s.setTimeOverride);
  const moveOccurrence = useTasksStore((s) => s.moveOccurrence);
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const toggleStarted = useTasksStore((s) => s.toggleStarted);
  const unlinkTask = useNotesStore((s) => s.unlinkTask);
  const syncLinksFromTask = useNotesStore((s) => s.syncLinksFromTask);
  const notes = useNotesStore((s) => s.notes);

  const initial: TaskDraft = useMemo(() => {
    if (task) {
      return {
        title: task.title,
        details: task.details ?? '',
        importance: task.importance,
        minutes: occState?.timeOverride ?? task.minutes,
        recurrence: task.recurrence,
        startDate: task.startDate,
        endDate: task.endDate,
        linkedNoteIds: task.linkedNoteIds,
        sections: task.sections,
        remindersEnabled: task.remindersEnabled,
        alarmEnabled: task.alarmEnabled,
      };
    }
    return { ...emptyTaskDraft(), startDate: contextDate };
    // Snapshot once — this seeds local state and must not clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [title, setTitle] = useState(initial.title);
  const [details, setDetails] = useState(initial.details ?? '');
  const [importance, setImportance] = useState<Importance>(initial.importance);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [recurrence, setRecurrence] = useState<Recurrence>(initial.recurrence);
  const [startDate, setStartDate] = useState<DateKey>(initial.startDate);
  const [endDate, setEndDate] = useState<DateKey | undefined>(initial.endDate);
  const [linkedNoteIds, setLinkedNoteIds] = useState<string[]>(initial.linkedNoteIds);
  const [sections, setSections] = useState<Section[]>(initial.sections);
  const [remindersEnabled, setReminders] = useState(initial.remindersEnabled);
  const [alarmEnabled, setAlarm] = useState(initial.alarmEnabled);

  const [showTime, setShowTime] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [showMove, setShowMove] = useState(false);

  const abandoned = useRef(false);
  const createdId = useRef<string | null>(null);

  const noteOptions = useMemo<LinkOption[]>(
    () =>
      Object.values(notes)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((note) => ({
          id: note.id,
          title: note.title || 'Untitled',
          subtitle: note.body.trim().slice(0, 60) || undefined,
          importance: note.importance,
        })),
    [notes],
  );

  const hasContent = title.trim().length > 0;
  const status = resolveStatus(occState);
  const isDone = status === 'done';
  const overdue = !isNew && !isDone && timestampFor(contextDate, minutes) <= Date.now();

  const snapshot = {
    title,
    details,
    importance,
    minutes,
    recurrence,
    startDate,
    endDate,
    linkedNoteIds,
    sections,
    remindersEnabled,
    alarmEnabled,
    hasContent,
  };
  const latest = useRef(snapshot);
  latest.current = snapshot;

  const persist = useCallback(() => {
    if (abandoned.current) return;
    const cur = latest.current;
    if (!cur.hasContent) return;

    // A time change on a repeating task applies to this day only, so the rule keeps its own time
    // and the difference is recorded as a per-day override. This only makes sense when the caller
    // actually named a day — otherwise the edit is about the task itself, and writing a per-day
    // override onto a day we picked for the user would be a silent surprise.
    const timeMovedOnThisDay =
      hasExplicitDate &&
      !isNew &&
      task != null &&
      cur.recurrence.kind !== 'once' &&
      cur.minutes !== task.minutes;

    const draft: TaskDraft = {
      title: cur.title.trim(),
      details: cur.details.trim() || undefined,
      importance: cur.importance,
      minutes: timeMovedOnThisDay ? task!.minutes : cur.minutes,
      recurrence: cur.recurrence,
      startDate: cur.startDate,
      // A one-off has no window, and hand-picked dates are their own window.
      endDate:
        cur.recurrence.kind === 'once' || cur.recurrence.kind === 'custom'
          ? undefined
          : cur.endDate,
      linkedNoteIds: cur.linkedNoteIds,
      sections: cur.sections,
      remindersEnabled: cur.remindersEnabled,
      alarmEnabled: cur.alarmEnabled,
    };

    let targetId: string;
    if (isNew) {
      if (createdId.current) {
        updateTask(createdId.current, draft);
        targetId = createdId.current;
      } else {
        targetId = addTask(draft);
        createdId.current = targetId;
      }
    } else {
      updateTask(id, draft);
      targetId = id;
      // Only ever touch a day's override when that day was explicitly the subject of this screen.
      if (hasExplicitDate) {
        setTimeOverride(id, contextDate, timeMovedOnThisDay ? cur.minutes : null);
      }
    }

    syncLinksFromTask(targetId, cur.linkedNoteIds);
  }, [
    isNew,
    id,
    task,
    contextDate,
    hasExplicitDate,
    addTask,
    updateTask,
    setTimeOverride,
    syncLinksFromTask,
  ]);

  React.useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => persist());
    return unsub;
  }, [navigation, persist]);

  const confirmDelete = () => {
    Alert.alert('Delete task', 'This removes the task and its history. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          abandoned.current = true;
          const target = isNew ? createdId.current : id;
          if (target) {
            unlinkTask(target);
            deleteTask(target);
          }
          router.back();
        },
      },
    ]);
  };

  const share = useShareSheet();

  /** Share what is on screen right now, not the last saved copy. */
  const openShare = useCallback(() => {
    const cur = latest.current;
    share.open(
      taskDoc(
        {
          id: isNew ? 'draft' : id,
          title: cur.title,
          details: cur.details,
          importance: cur.importance,
          minutes: cur.minutes,
          recurrence: cur.recurrence,
          startDate: cur.startDate,
          endDate: cur.endDate,
          linkedNoteIds: cur.linkedNoteIds,
          sections: cur.sections,
          remindersEnabled: cur.remindersEnabled,
          alarmEnabled: cur.alarmEnabled,
          createdAt: task?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        },
        notes,
      ),
    );
  }, [share, isNew, id, task?.createdAt, notes]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isNew ? 'New task' : 'Edit task',
      headerRight: () => (
        <Pressable
          onPress={openShare}
          disabled={!hasContent}
          hitSlop={10}
          accessibilityLabel="Share task"
          style={({ pressed }) => ({
            padding: 8,
            marginRight: 8,
            opacity: !hasContent ? 0.35 : pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="share-outline" size={21} color={t.accent} />
        </Pressable>
      ),
    });
  }, [navigation, isNew, hasContent, openShare, t]);

  const toggleWeekday = (day: number) => {
    const days = recurrence.kind === 'weekdays' ? recurrence.days : [];
    setRecurrence({
      kind: 'weekdays',
      days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort(),
    });
  };

  const toggleCustomDate = (key: DateKey) => {
    const dates = recurrence.kind === 'custom' ? recurrence.dates : [];
    setRecurrence({
      kind: 'custom',
      dates: dates.includes(key) ? dates.filter((d) => d !== key) : [...dates, key].sort(),
    });
  };

  const moveTo = (target: DateKey) => {
    persist();
    const taskId = isNew ? createdId.current : id;
    if (!taskId) return;
    moveOccurrence(taskId, contextDate, target);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 48 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Status — colour-coded, matching Statistics exactly. */}
        {!isNew ? (
          <View style={{ gap: 10 }}>
            <SectionTitle>Status on {formatRelativeDay(contextDate)}</SectionTitle>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 14,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: overdue ? OVERDUE_COLOR : STATUS_COLORS[status],
                backgroundColor: `${overdue ? OVERDUE_COLOR : STATUS_COLORS[status]}18`,
              }}
            >
              <Ionicons
                name={
                  status === 'done'
                    ? 'checkmark-circle'
                    : status === 'in_progress'
                      ? 'play-circle'
                      : overdue
                        ? 'alert-circle'
                        : 'ellipse-outline'
                }
                size={22}
                color={overdue ? OVERDUE_COLOR : STATUS_COLORS[status]}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: overdue ? OVERDUE_COLOR : STATUS_COLORS[status],
                    fontWeight: '800',
                    fontSize: 15.5,
                  }}
                >
                  {STATUS_LABELS[status]}
                  {overdue ? ' · Overdue' : ''}
                </Text>
                <Text style={{ color: t.textDim, fontSize: 12.5, marginTop: 2 }}>
                  {formatLongDate(contextDate)} at {formatTime(minutes)}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 9 }}>
              <Button
                label={status === 'done' ? 'Mark not done' : 'Mark done'}
                icon={status === 'done' ? 'close-circle-outline' : 'checkmark-circle-outline'}
                variant={status === 'done' ? 'secondary' : 'primary'}
                onPress={() => toggleDone(id, contextDate)}
                style={{ flex: 1 }}
              />
              {status !== 'done' ? (
                <Button
                  label={status === 'in_progress' ? 'Not started' : 'Start'}
                  icon="play-outline"
                  variant="secondary"
                  onPress={() => toggleStarted(id, contextDate)}
                  style={{ flex: 1 }}
                />
              ) : null}
            </View>

            {/* Move to another day, keeping the original date on record. */}
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <Button
                label="Shift to tomorrow"
                icon="arrow-forward-circle-outline"
                variant="secondary"
                onPress={() => moveTo(addDays(contextDate, 1))}
                style={{ flex: 1 }}
              />
              <Button
                label="Pick day"
                icon="calendar-outline"
                variant="secondary"
                onPress={() => setShowMove(true)}
                style={{ flex: 1 }}
              />
            </View>
            {occState?.movedTo ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  padding: 11,
                  borderRadius: 10,
                  backgroundColor: t.surfaceAlt,
                }}
              >
                <Ionicons name="git-branch-outline" size={15} color={t.textDim} />
                <Text style={{ color: t.textDim, fontSize: 12.5, flex: 1 }}>
                  Shifted to {formatLongDate(occState.movedTo)} · originally{' '}
                  {formatLongDate(contextDate)}
                </Text>
                <Pressable onPress={() => moveOccurrence(id, contextDate, null)} hitSlop={8}>
                  <Text style={{ color: t.accent, fontSize: 12.5, fontWeight: '700' }}>Undo</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        <Field
          label="Task"
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          autoFocus={isNew}
        />
        <Field
          label="Details (optional)"
          value={details}
          onChangeText={setDetails}
          placeholder="Any extra context…"
          multiline
          style={{ minHeight: 80 }}
        />

        <View style={{ gap: 10 }}>
          <SectionTitle>Time</SectionTitle>
          <Pressable
            onPress={() => setShowTime(true)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              backgroundColor: t.surface,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 15,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="time-outline" size={21} color={t.accent} />
            <Text style={{ flex: 1, color: t.text, fontSize: 19, fontWeight: '800' }}>
              {formatTime(minutes)}
            </Text>
            <Text style={{ color: t.textDim, fontSize: 13 }}>Tap to change</Text>
          </Pressable>
          {!isNew && task && recurrence.kind !== 'once' && minutes !== task.minutes ? (
            <Text style={{ color: t.textDim, fontSize: 12.5 }}>
              Applies to {formatRelativeDay(contextDate)} only — the repeat keeps{' '}
              {formatTime(task.minutes)}.
            </Text>
          ) : null}
        </View>

        <View style={{ gap: 10 }}>
          <SectionTitle>Repeat</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {RECURRENCE_OPTIONS.map((opt) => {
              const active = recurrence.kind === opt.kind;
              return (
                <Pressable
                  key={opt.kind}
                  onPress={() => {
                    if (opt.kind === 'weekdays')
                      setRecurrence({ kind: 'weekdays', days: [1, 2, 3, 4, 5] });
                    else if (opt.kind === 'custom')
                      setRecurrence({ kind: 'custom', dates: [startDate] });
                    else setRecurrence({ kind: opt.kind } as Recurrence);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: active ? t.accent : t.border,
                    backgroundColor: active ? t.accent : t.surface,
                    opacity: pressed && !active ? 0.7 : 1,
                  })}
                >
                  <Text
                    style={{
                      color: active ? t.onAccent : t.text,
                      fontWeight: '700',
                      fontSize: 13.5,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {recurrence.kind === 'weekdays' ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
              {WEEKDAY_NAMES.map((name, day) => {
                const on = recurrence.days.includes(day);
                return (
                  <Pressable
                    key={day}
                    onPress={() => toggleWeekday(day)}
                    style={({ pressed }) => ({
                      flex: 1,
                      paddingVertical: 11,
                      borderRadius: 9,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: on ? t.accent : t.border,
                      backgroundColor: on ? `${t.accent}22` : t.surface,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text
                      style={{ color: on ? t.accent : t.textDim, fontWeight: '700', fontSize: 11.5 }}
                    >
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {recurrence.kind === 'custom' ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {recurrence.dates.map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => toggleCustomDate(d)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 11,
                      paddingVertical: 7,
                      borderRadius: 8,
                      backgroundColor: t.surfaceAlt,
                      borderWidth: 1,
                      borderColor: t.border,
                    }}
                  >
                    <Text style={{ color: t.text, fontSize: 12.5, fontWeight: '600' }}>
                      {formatLongDate(d)}
                    </Text>
                    <Ionicons name="close" size={13} color={t.textDim} />
                  </Pressable>
                ))}
              </View>
              <Button
                label="Add a date"
                icon="calendar-outline"
                variant="secondary"
                onPress={() => setShowCustom(true)}
              />
            </View>
          ) : (
            <Card style={{ paddingHorizontal: 15 }}>
              <DateRow
                label={recurrence.kind === 'once' ? 'Date' : 'Starts'}
                value={formatLongDate(startDate)}
                onPress={() => setShowStart(true)}
              />
              {recurrence.kind !== 'once' ? (
                <>
                  <View style={{ height: 1, backgroundColor: t.border }} />
                  <DateRow
                    label="Ends"
                    value={endDate ? formatLongDate(endDate) : 'No end date'}
                    muted={!endDate}
                    onPress={() => setShowEnd(true)}
                    onClear={endDate ? () => setEndDate(undefined) : undefined}
                  />
                </>
              ) : null}
            </Card>
          )}

          {recurrence.kind !== 'once' && recurrence.kind !== 'custom' ? (
            <Text style={{ color: t.textDim, fontSize: 12.5, lineHeight: 18 }}>
              {endDate
                ? `Repeats from ${formatLongDate(startDate)} until ${formatLongDate(endDate)}, then stops.`
                : 'Repeats from the start date onwards. Add an end date to stop it automatically.'}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: 10 }}>
          <SectionTitle>Reminders</SectionTitle>
          <Card style={{ paddingHorizontal: 15 }}>
            <ToggleRow
              icon="notifications-outline"
              label="Notify me"
              hint="30 minutes and 5 minutes before"
              value={remindersEnabled}
              onChange={setReminders}
            />
            <View style={{ height: 1, backgroundColor: t.border }} />
            <ToggleRow
              icon="alarm-outline"
              label="Alarm at task time"
              hint="Rings on the lock screen until you stop it"
              value={alarmEnabled}
              onChange={setAlarm}
            />
          </Card>
        </View>

        <View style={{ gap: 10 }}>
          <SectionTitle>Importance</SectionTitle>
          <ColorPicker value={importance} onChange={setImportance} />
        </View>

        <SectionsEditor sections={sections} onChange={setSections} />

        <LinkPicker
          label="Linked notes"
          emptyLabel="No notes to link yet."
          options={noteOptions}
          selectedIds={linkedNoteIds}
          onChange={setLinkedNoteIds}
          onOpen={(noteId) => router.push({ pathname: '/note/[id]', params: { id: noteId } })}
        />

        {!isNew || createdId.current ? (
          <Button
            label="Delete task"
            icon="trash-outline"
            variant="danger"
            onPress={confirmDelete}
          />
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, opacity: 0.7 }}>
          <Ionicons name="cloud-done-outline" size={14} color={t.textFaint} />
          <Text style={{ color: t.textFaint, fontSize: 12 }}>Changes save when you go back.</Text>
        </View>
      </ScrollView>

      {showTime ? (
        <DateTimePicker
          value={(() => {
            const d = new Date();
            d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
            return d;
          })()}
          mode="time"
          is24Hour={false}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, d) => {
            setShowTime(false);
            if (event.type === 'set' && d) setMinutes(d.getHours() * 60 + d.getMinutes());
          }}
        />
      ) : null}

      {showStart ? (
        <DateTimePicker
          value={fromKey(startDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(event, d) => {
            setShowStart(false);
            if (event.type !== 'set' || !d) return;
            const key = toKey(d);
            setStartDate(key);
            // Push the end out with the start rather than leaving a window that never opens.
            if (endDate && endDate < key) setEndDate(key);
          }}
        />
      ) : null}

      {showEnd ? (
        <DateTimePicker
          value={fromKey(endDate ?? startDate)}
          mode="date"
          minimumDate={fromKey(startDate)}
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(event, d) => {
            setShowEnd(false);
            if (event.type !== 'set' || !d) return;
            const key = toKey(d);
            // Clamp instead of validating later, so an impossible window cannot be entered at all.
            setEndDate(key < startDate ? startDate : key);
          }}
        />
      ) : null}

      {showCustom ? (
        <DateTimePicker
          value={fromKey(startDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(event, d) => {
            setShowCustom(false);
            if (event.type === 'set' && d) toggleCustomDate(toKey(d));
          }}
        />
      ) : null}

      {showMove ? (
        <DateTimePicker
          value={fromKey(contextDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(event, d) => {
            setShowMove(false);
            if (event.type === 'set' && d) moveTo(toKey(d));
          }}
        />
      ) : null}

      {share.element}
    </KeyboardAvoidingView>
  );
}

function DateRow({
  label,
  value,
  muted,
  onPress,
  onClear,
}: {
  label: string;
  value: string;
  muted?: boolean;
  onPress: () => void;
  onClear?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          paddingVertical: 14,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="calendar-outline" size={18} color={t.textDim} />
        <Text style={{ flex: 1, color: t.text, fontSize: 15 }}>{label}</Text>
        <Text
          style={{
            color: muted ? t.textFaint : t.accent,
            fontSize: 15,
            fontWeight: muted ? '500' : '700',
          }}
        >
          {value}
        </Text>
      </Pressable>
      {onClear ? (
        <Pressable
          onPress={onClear}
          hitSlop={8}
          accessibilityLabel={`Clear ${label.toLowerCase()} date`}
          style={({ pressed }) => ({ paddingLeft: 10, opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="close-circle" size={18} color={t.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 }}>
      <Ionicons name={icon} size={20} color={t.textDim} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 15.5, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: t.textDim, fontSize: 12.5, marginTop: 2 }}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.accent, false: t.border }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}
