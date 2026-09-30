import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DateKey, Occurrence, StatsRange, TaskStatus } from '@/types';
import { useTasksStore } from '@/store/useTasksStore';
import { useTheme } from '@/theme/ThemeProvider';
import { STATUS_COLORS, STATUS_LABELS, STATUS_ORDER } from '@/theme/themes';
import { SegmentedBar } from '@/components/SegmentedBar';
import { TabHeader } from '@/components/TabHeader';
import { TaskRow } from '@/components/TaskRow';
import { Card, EmptyState, Segmented, SectionTitle } from '@/components/ui';
import { countByStatus, type StatusCounts } from '@/lib/status';
import {
  addMonths,
  eachDay,
  endOfMonth,
  formatLongDate,
  formatMonthLabel,
  formatMonthShort,
  formatRelativeDay,
  fromKey,
  startOfMonth,
  toKey,
  todayKey,
} from '@/lib/date';
import { rangeBounds, useNow, useRangeOccurrences } from '@/lib/useOccurrences';

const RANGE_OPTIONS: { value: StatsRange; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

/** A month's fixed weeks: 1–7, 8–14, 15–21, 22–28, and the tail as week 5. */
function weeksOfMonth(monthKey: DateKey): { week: number; from: DateKey; to: DateKey }[] {
  const base = fromKey(monthKey);
  const lastDay = endOfMonth(monthKey).slice(-2);
  const last = Number(lastDay);
  const out: { week: number; from: DateKey; to: DateKey }[] = [];
  for (let w = 0; w < 5; w += 1) {
    const startDay = 1 + w * 7;
    if (startDay > last) break;
    const endDay = Math.min(startDay + 6, last);
    const day = (d: number) =>
      toKey(new Date(base.getFullYear(), base.getMonth(), d));
    out.push({ week: w + 1, from: day(startDay), to: day(endDay) });
  }
  return out;
}

function weekRangeLabel(from: DateKey, to: DateKey): string {
  const f = fromKey(from);
  const t = fromKey(to);
  if (f.getMonth() === t.getMonth()) {
    return `${f.getDate()}–${t.getDate()} ${formatMonthShort(to)}`;
  }
  return `${f.getDate()} ${formatMonthShort(from)} – ${t.getDate()} ${formatMonthShort(to)}`;
}

export default function StatsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const [range, setRange] = useState<StatsRange>('daily');
  const [focus, setFocus] = useState<TaskStatus | null>(null);

  // Monthly's own anchor (any month, not just the current one) and the
  // drill-down: month → week (1–5 within the month) → date. `drill.month` is
  // set when diving in from the yearly view (which year-month was tapped);
  // monthly always drills into the anchor itself.
  const [monthAnchor, setMonthAnchor] = useState<DateKey>(startOfMonth(todayKey()));
  const [drill, setDrill] = useState<{
    month: DateKey | null;
    week: number | null;
    day: DateKey | null;
  } | null>(null);

  const bounds = useMemo(() => rangeBounds(range), [range]);
  const monthFrom = startOfMonth(monthAnchor);
  const monthTo = endOfMonth(monthAnchor);

  const occurrences = useRangeOccurrences(
    range === 'monthly' ? monthFrom : bounds.from,
    range === 'monthly' ? monthTo : bounds.to,
    now,
  );
  const counts = useMemo(() => countByStatus(occurrences), [occurrences]);

  // Changing month or range drops the drill-down — stale state reads as a bug.
  useEffect(() => setDrill(null), [range, monthAnchor]);

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

  const weeks = useMemo(
    () => weeksOfMonth(monthAnchor),
    [monthAnchor],
  );

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

  const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  const peak = useMemo(() => Math.max(1, ...months.map((m) => m.counts.total)), [months]);

  const drillInMonth = (key: DateKey) => setDrill({ month: key, week: null, day: null });
  const drillMonth = drill?.month ?? monthAnchor;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TabHeader title="Statistics" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90, gap: 18 }}
      >
        <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} />

        {/* ---- Top summary ---- */}
        <ReportCard
          label={
            range === 'monthly' ? formatMonthLabel(monthAnchor) : bounds.label
          }
          rangeText={
            range === 'monthly'
              ? `${formatLongDate(monthFrom)} — ${formatLongDate(monthTo)}`
              : bounds.from !== bounds.to
                ? `${formatLongDate(bounds.from)} — ${formatLongDate(bounds.to)}`
                : undefined
          }
          counts={counts}
        >
          {range === 'monthly' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26, marginTop: 2 }}>
              <ArrowButton
                icon="chevron-back"
                onPress={() => setMonthAnchor(addMonths(monthAnchor, -1))}
                label="Previous month"
              />
              <Pressable onPress={() => setMonthAnchor(startOfMonth(todayKey()))} hitSlop={6}>
                <Text style={{ color: t.accent, fontSize: 12.5, fontWeight: '800' }}>
                  {monthAnchor === startOfMonth(todayKey()) ? '' : 'Jump to current'}
                </Text>
              </Pressable>
              <ArrowButton
                icon="chevron-forward"
                onPress={() => setMonthAnchor(addMonths(monthAnchor, 1))}
                label="Next month"
              />
            </View>
          ) : null}
        </ReportCard>

        {/* ---- Monthly: weeks of the month, then drill to a date ---- */}
        {range === 'monthly' ? (
          <MonthDrill
            monthKey={monthAnchor}
            occurrences={occurrences}
            drill={drill ? { week: drill.week, day: drill.day } : null}
            onDrill={(d) => setDrill(d ? { ...d, month: null } : null)}
            onToggleDone={toggleDone}
            onToggleStarted={toggleStarted}
          />
        ) : null}

        {/* ---- Yearly: month chart + table, months are tappable ---- */}
        {range === 'yearly' ? (
          <View style={{ gap: 12 }}>
            <SectionTitle>Month by month · tap a month to dive in</SectionTitle>
            <Card style={{ padding: 16, gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 128 }}>
                {months.map((m) => {
                  const h = (m.counts.total / peak) * 100;
                  const doneH = m.counts.total === 0 ? 0 : (m.counts.done / m.counts.total) * h;
                  const progH =
                    m.counts.total === 0 ? 0 : (m.counts.in_progress / m.counts.total) * h;
                  const restH = h - doneH - progH;
                  return (
                    <Pressable
                      key={m.key}
                      onPress={() => drillInMonth(m.key)}
                      style={{ flex: 1, alignItems: 'center', gap: 5 }}
                      accessibilityLabel={`Open ${formatMonthLabel(m.key)}`}
                    >
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
                        <View style={{ height: `${restH}%`, backgroundColor: STATUS_COLORS.not_started }} />
                        <View style={{ height: `${progH}%`, backgroundColor: STATUS_COLORS.in_progress }} />
                        <View style={{ height: `${doneH}%`, backgroundColor: STATUS_COLORS.done }} />
                      </View>
                      <Text style={{ color: t.textDim, fontSize: 9.5, fontWeight: '700' }}>
                        {formatMonthShort(m.key)}
                      </Text>
                    </Pressable>
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
                    <Pressable
                      key={m.key}
                      onPress={() => drillInMonth(m.key)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        padding: 14,
                        borderTopWidth: i === 0 ? 0 : 1,
                        borderTopColor: t.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
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
                      <Ionicons name="chevron-forward" size={15} color={t.textFaint} />
                    </Pressable>
                  );
                })}
              {months.every((m) => m.counts.total === 0) ? (
                <Text style={{ padding: 16, color: t.textFaint, fontSize: 13 }}>
                  No tasks in the last 12 months yet.
                </Text>
              ) : null}
            </Card>

            {drill ? (
              <MonthDrill
                monthKey={drillMonth}
                occurrences={occurrences}
                drill={{ week: drill.week, day: drill.day }}
                onDrill={(d) => setDrill(d ? { ...d, month: drill.month } : null)}
                onToggleDone={toggleDone}
                onToggleStarted={toggleStarted}
              />
            ) : null}
          </View>
        ) : null}

        {/* ---- The 3 status buttons ---- */}
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
                  {STATUS_LABELS[focus]} ·{' '}
                  {range === 'monthly' ? formatMonthLabel(monthAnchor) : bounds.label}
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

        {counts.total === 0 && !drill ? (
          <EmptyState
            icon="stats-chart-outline"
            title="Nothing to measure yet"
            subtitle="Add tasks and the breakdown fills in here. Ticking an old task updates these numbers straight away."
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ArrowButton({
  icon,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        padding: 8,
        borderRadius: 10,
        backgroundColor: t.surfaceAlt,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={t.accent} />
    </Pressable>
  );
}

function ReportCard({
  label,
  rangeText,
  counts,
  children,
}: {
  label: string;
  rangeText?: string;
  counts: StatusCounts;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const pct = (n: number) => (counts.total === 0 ? 0 : Math.round((n / counts.total) * 100));
  return (
    <Card style={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.textDim, fontSize: 12.5, fontWeight: '700' }}>
            {label.toUpperCase()}
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

      {rangeText ? <Text style={{ color: t.textFaint, fontSize: 11.5 }}>{rangeText}</Text> : null}
      {children}
    </Card>
  );
}

type Drill = { week: number | null; day: DateKey | null };

/**
 * The month → week → date drill-down shared by the Monthly and Yearly ranges.
 * Week 5 holds the month's tail (29th onward) only when it exists.
 */
function MonthDrill({
  monthKey,
  occurrences,
  drill,
  onDrill,
  onToggleDone,
  onToggleStarted,
}: {
  monthKey: DateKey;
  occurrences: Occurrence[];
  drill: Drill | null;
  onDrill: (d: Drill | null) => void;
  onToggleDone: (taskId: string, date: DateKey) => void;
  onToggleStarted: (taskId: string, date: DateKey) => void;
}) {
  const t = useTheme();
  const inMonth = useMemo(
    () => occurrences.filter((o) => o.date >= startOfMonth(monthKey) && o.date <= endOfMonth(monthKey)),
    [occurrences, monthKey],
  );
  const weeks = useMemo(() => weeksOfMonth(monthKey), [monthKey]);

  const weekDef = drill?.week != null ? weeks[drill.week - 1] : null;
  const weekCounts = useMemo(
    () =>
      weekDef
        ? countByStatus(inMonth.filter((o) => o.date >= weekDef.from && o.date <= weekDef.to))
        : null,
    [inMonth, weekDef],
  );
  const dayCounts = useMemo(() => {
    if (!weekDef) return [];
    return eachDay(weekDef.from, weekDef.to).map((day) => ({
      day,
      counts: countByStatus(inMonth.filter((o) => o.date === day)),
    }));
  }, [weekDef, inMonth]);
  const dayItems = useMemo(() => {
    if (!drill?.day) return [];
    return inMonth
      .filter((o) => o.date === drill.day)
      .sort((a, b) => a.minutes - b.minutes);
  }, [inMonth, drill?.day]);

  const monthLabel = formatMonthLabel(monthKey);

  return (
    <View style={{ gap: 12 }}>
      {/* Breadcrumb chips: month › week › date — each segment jumps to that level. */}
      {drill ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <BreadcrumbChip label={monthLabel} onPress={() => onDrill(null)} />
          {weekDef ? (
            <>
              <Crumbs />
              <BreadcrumbChip
                label={`Week ${drill!.week}`}
                onPress={() => onDrill({ week: drill!.week, day: null })}
                active={!!drill.day}
              />
            </>
          ) : null}
          {drill.day ? (
            <>
              <Crumbs />
              <BreadcrumbChip label={formatLongDate(drill.day)} active />
            </>
          ) : null}
        </View>
      ) : null}

      {/* Level 1: the month's report, then its weeks as chips. */}
      {!drill ? (
        <>
          <SectionTitle>Weeks in {monthLabel}</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {weeks.map((w) => {
              const c = countByStatus(inMonth.filter((o) => o.date >= w.from && o.date <= w.to));
              return (
                <Pressable
                  key={w.week}
                  onPress={() => onDrill({ week: w.week, day: null })}
                  style={({ pressed }) => ({
                    flexGrow: 1,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: t.border,
                    backgroundColor: t.surface,
                    paddingHorizontal: 13,
                    paddingVertical: 10,
                    gap: 2,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '800' }}>
                    Week {w.week}
                    <Text style={{ color: t.textFaint, fontWeight: '600', fontSize: 11.5 }}>
                      {'  '}{weekRangeLabel(w.from, w.to)}
                    </Text>
                  </Text>
                  <Text style={{ color: t.textDim, fontSize: 12 }}>
                    {c.done}/{c.total} done
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Level 2: a week's report, then its dates as a compact grid. */}
      {drill && weekDef && !drill.day ? (
        <>
          <ReportCard
            label={`${monthLabel} · Week ${drill.week}`}
            rangeText={`${formatLongDate(weekDef.from)} — ${formatLongDate(weekDef.to)}`}
            counts={weekCounts!}
          />
          <SectionTitle>Dates in week {drill.week}</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {dayCounts.map((d) => (
              <Pressable
                key={d.day}
                onPress={() => onDrill({ week: drill.week, day: d.day })}
                style={({ pressed }) => ({
                  width: 86,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: d.counts.total > 0 ? t.accent : t.border,
                  backgroundColor: t.surface,
                  alignItems: 'center',
                  paddingVertical: 10,
                  gap: 2,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: t.text, fontSize: 13, fontWeight: '800' }}>
                  {fromKey(d.day).getDate()} {formatMonthShort(d.day)}
                </Text>
                <Text
                  style={{
                    color: d.counts.total > 0 ? STATUS_COLORS.done : t.textFaint,
                    fontSize: 11.5,
                    fontWeight: '700',
                  }}
                >
                  {d.counts.done}/{d.counts.total}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {/* Level 3: a single date's report and its tasks. */}
      {drill?.day ? (
        <>
          <ReportCard
            label={`${monthLabel}${weekDef ? ` · Week ${drill.week}` : ''} · ${formatRelativeDay(drill.day)}`}
            rangeText={formatLongDate(drill.day)}
            counts={countByStatus(dayItems)}
          />
          {dayItems.length === 0 ? (
            <Card style={{ padding: 8 }}>
              <EmptyState
                icon="albums-outline"
                title="Nothing on this day"
                subtitle="No tasks were scheduled for this date."
              />
            </Card>
          ) : (
            dayItems.map((o) => (
              <TaskRow
                key={`${o.task.id}|${o.stateDate}`}
                occurrence={o}
                onPress={() =>
                  router.push({
                    pathname: '/task/[id]',
                    params: { id: o.task.id, date: o.stateDate },
                  })
                }
                onToggleDone={() => onToggleDone(o.task.id, o.stateDate)}
                onToggleStarted={() => onToggleStarted(o.task.id, o.stateDate)}
              />
            ))
          )}
        </>
      ) : null}
    </View>
  );
}

function BreadcrumbChip({
  label,
  onPress,
  active,
}: {
  label: string;
  onPress?: () => void;
  active?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 9,
        backgroundColor: active ? t.accent : t.surfaceAlt,
        opacity: onPress && pressed ? 0.7 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        style={{
          color: active ? t.onAccent : t.text,
          fontSize: 12.5,
          fontWeight: '800',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Crumbs() {
  const t = useTheme();
  return <Ionicons name="chevron-forward" size={13} color={t.textFaint} />;
}
