import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Occurrence, StatsRange, TaskStatus } from '@/types';
import { useTasksStore } from '@/store/useTasksStore';
import { useTheme } from '@/theme/ThemeProvider';
import { STATUS_COLORS, STATUS_LABELS, STATUS_ORDER } from '@/theme/themes';
import { SegmentedBar } from '@/components/SegmentedBar';
import { TaskRow } from '@/components/TaskRow';
import { Card, EmptyState, Segmented, SectionTitle } from '@/components/ui';
import { countByStatus } from '@/lib/status';
import {
  addMonths,
  endOfMonth,
  formatLongDate,
  formatMonthLabel,
  formatMonthShort,
  formatRelativeDay,
  startOfMonth,
  todayKey,
} from '@/lib/date';
import { rangeBounds, useNow, useRangeOccurrences } from '@/lib/useOccurrences';

const RANGE_OPTIONS: { value: StatsRange; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export default function StatsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const [range, setRange] = useState<StatsRange>('daily');
  const [focus, setFocus] = useState<TaskStatus | null>(null);

  const bounds = useMemo(() => rangeBounds(range), [range]);
  const occurrences = useRangeOccurrences(bounds.from, bounds.to, now);
  const counts = useMemo(() => countByStatus(occurrences), [occurrences]);

  const toggleDone = useTasksStore((s) => s.toggleDone);
  const toggleStarted = useTasksStore((s) => s.toggleStarted);

  /** Per-month rollup for the yearly view. */
  const months = useMemo(() => {
    if (range !== 'yearly') return [];
    const anchor = todayKey();
    return Array.from({ length: 12 }, (_, i) => {
      const monthStart = addMonths(anchor, -(11 - i));
      const from = startOfMonth(monthStart);
      const to = endOfMonth(monthStart);
      const inMonth = occurrences.filter((o) => o.date >= from && o.date <= to);
      return { key: monthStart, from, to, counts: countByStatus(inMonth) };
    });
  }, [range, occurrences]);

  const focused = useMemo(() => {
    if (!focus) return [];
    return occurrences
      .filter((o) => o.status === focus)
      .sort((a, b) => (a.date === b.date ? a.minutes - b.minutes : b.date.localeCompare(a.date)));
  }, [occurrences, focus]);

  const grouped = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of focused) {
      const list = map.get(o.date);
      if (list) list.push(o);
      else map.set(o.date, [o]);
    }
    return [...map.entries()];
  }, [focused]);

  const pct = (n: number) => (counts.total === 0 ? 0 : Math.round((n / counts.total) * 100));
  const peak = useMemo(() => Math.max(1, ...months.map((m) => m.counts.total)), [months]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90, gap: 18 }}
    >
      <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} />

      <Card style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.textDim, fontSize: 12.5, fontWeight: '700' }}>
              {bounds.label.toUpperCase()}
            </Text>
            <Text style={{ color: t.text, fontSize: 30, fontWeight: '800', marginTop: 2 }}>
              {counts.total}
            </Text>
            <Text style={{ color: t.textDim, fontSize: 13 }}>
              {counts.total === 1 ? 'task total' : 'tasks total'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: STATUS_COLORS.done, fontSize: 26, fontWeight: '800' }}>
              {pct(counts.done)}%
            </Text>
            <Text style={{ color: t.textDim, fontSize: 12.5 }}>complete</Text>
          </View>
        </View>

        <SegmentedBar counts={counts} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {STATUS_ORDER.map((status) => (
            <View key={status} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: STATUS_COLORS[status] }}
              />
              <Text style={{ color: t.textDim, fontSize: 12.5 }}>
                {STATUS_LABELS[status]}{' '}
                <Text style={{ color: t.text, fontWeight: '800' }}>{counts[status]}</Text>
              </Text>
            </View>
          ))}
        </View>

        {bounds.from !== bounds.to ? (
          <Text style={{ color: t.textFaint, fontSize: 11.5 }}>
            {formatLongDate(bounds.from)} — {formatLongDate(bounds.to)}
          </Text>
        ) : null}
      </Card>

      {/* Month-by-month for the last year */}
      {range === 'yearly' ? (
        <View style={{ gap: 12 }}>
          <SectionTitle>Month by month</SectionTitle>
          <Card style={{ padding: 16, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 128 }}>
              {months.map((m) => {
                const h = (m.counts.total / peak) * 100;
                const doneH = m.counts.total === 0 ? 0 : (m.counts.done / m.counts.total) * h;
                const progH =
                  m.counts.total === 0 ? 0 : (m.counts.in_progress / m.counts.total) * h;
                const restH = h - doneH - progH;
                return (
                  <View key={m.key} style={{ flex: 1, alignItems: 'center', gap: 5 }}>
                    <Text style={{ color: t.textFaint, fontSize: 9.5 }}>
                      {m.counts.total || ''}
                    </Text>
                    <View
                      style={{
                        width: '100%',
                        height: 92,
                        justifyContent: 'flex-end',
                        borderRadius: 4,
                        overflow: 'hidden',
                        backgroundColor: t.surfaceAlt,
                      }}
                    >
                      {/* Stacked bottom-up: not started, in progress, done. */}
                      <View style={{ height: `${restH}%`, backgroundColor: STATUS_COLORS.not_started }} />
                      <View style={{ height: `${progH}%`, backgroundColor: STATUS_COLORS.in_progress }} />
                      <View style={{ height: `${doneH}%`, backgroundColor: STATUS_COLORS.done }} />
                    </View>
                    <Text style={{ color: t.textDim, fontSize: 9.5, fontWeight: '700' }}>
                      {formatMonthShort(m.key)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Card>

          <Card style={{ overflow: 'hidden' }}>
            {months
              .filter((m) => m.counts.total > 0)
              .reverse()
              .map((m, i) => {
                const rate = Math.round((m.counts.done / m.counts.total) * 100);
                return (
                  <View
                    key={m.key}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: 14,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: t.border,
                    }}
                  >
                    <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', width: 84 }}>
                      {formatMonthLabel(m.key)}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <SegmentedBar counts={m.counts} height={10} />
                    </View>
                    <Text
                      style={{
                        color: rate >= 70 ? STATUS_COLORS.done : t.textDim,
                        fontSize: 13,
                        fontWeight: '800',
                        width: 42,
                        textAlign: 'right',
                      }}
                    >
                      {rate}%
                    </Text>
                  </View>
                );
              })}
            {months.every((m) => m.counts.total === 0) ? (
              <Text style={{ padding: 16, color: t.textFaint, fontSize: 13 }}>
                No tasks in the last 12 months yet.
              </Text>
            ) : null}
          </Card>
        </View>
      ) : null}

      {/* The 3 status buttons */}
      <View style={{ gap: 10 }}>
        <SectionTitle>Break it down</SectionTitle>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {STATUS_ORDER.map((status) => {
            const active = focus === status;
            return (
              <Pressable
                key={status}
                onPress={() => setFocus(active ? null : status)}
                style={({ pressed }) => ({
                  flex: 1,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? STATUS_COLORS[status] : t.border,
                  backgroundColor: active ? `${STATUS_COLORS[status]}1A` : t.surface,
                  opacity: pressed ? 0.75 : 1,
                  gap: 5,
                })}
              >
                <View
                  style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUS_COLORS[status] }}
                />
                <Text style={{ color: t.text, fontSize: 21, fontWeight: '800' }}>
                  {counts[status]}
                </Text>
                <Text style={{ color: t.textDim, fontSize: 11.5, fontWeight: '700' }}>
                  {STATUS_LABELS[status]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {focus ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <SectionTitle>
                {STATUS_LABELS[focus]} · {bounds.label}
              </SectionTitle>
            </View>
            <Pressable onPress={() => setFocus(null)} hitSlop={10}>
              <Text style={{ color: t.accent, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>
                Clear
              </Text>
            </Pressable>
          </View>

          {grouped.length === 0 ? (
            <Card style={{ padding: 8 }}>
              <EmptyState
                icon="albums-outline"
                title={`Nothing ${STATUS_LABELS[focus].toLowerCase()}`}
                subtitle="Nothing in this bucket for the selected range."
              />
            </Card>
          ) : (
            grouped.map(([date, items]) => (
              <View key={date} style={{ gap: 8 }}>
                <Text style={{ color: t.textDim, fontSize: 13, fontWeight: '700' }}>
                  {formatRelativeDay(date)}
                  <Text style={{ color: t.textFaint, fontWeight: '500' }}>
                    {'  '}
                    {formatLongDate(date)}
                  </Text>
                </Text>
                {items.map((o) => (
                  <TaskRow
                    key={`${o.task.id}|${o.stateDate}`}
                    occurrence={o}
                    onPress={() =>
                      router.push({
                        pathname: '/task/[id]',
                        params: { id: o.task.id, date: o.stateDate },
                      })
                    }
                    onToggleDone={() => toggleDone(o.task.id, o.stateDate)}
                    onToggleStarted={() => toggleStarted(o.task.id, o.stateDate)}
                  />
                ))}
              </View>
            ))
          )}
        </View>
      ) : null}

      {counts.total === 0 ? (
        <EmptyState
          icon="stats-chart-outline"
          title="Nothing to measure yet"
          subtitle="Add tasks and the breakdown fills in here. Ticking an old task updates these numbers straight away."
        />
      ) : null}
    </ScrollView>
  );
}
