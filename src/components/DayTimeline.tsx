import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Occurrence } from '@/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatHour } from '@/lib/date';
import { TaskRow } from './TaskRow';

type HourGroup = { hour: number; items: Occurrence[] };

/**
 * Day view grouped by hour.
 *
 * Hours with nothing scheduled are omitted rather than drawn as empty rows —
 * a full 24-row grid is mostly dead space on a phone, and grouping still gives
 * the thing that matters: every task sitting in front of its hour, so two 11am
 * tasks visibly share the 11 AM slot.
 */
export function DayTimeline({
  occurrences,
  now,
  onPressTask,
  onLongPressTask,
  onToggleDone,
  onToggleStarted,
}: {
  occurrences: Occurrence[];
  now: number;
  onPressTask: (o: Occurrence) => void;
  onLongPressTask?: (o: Occurrence) => void;
  onToggleDone: (o: Occurrence) => void;
  onToggleStarted: (o: Occurrence) => void;
}) {
  const t = useTheme();

  const groups = useMemo<HourGroup[]>(() => {
    const map = new Map<number, Occurrence[]>();
    for (const o of occurrences) {
      const hour = Math.floor(o.minutes / 60);
      const list = map.get(hour);
      if (list) list.push(o);
      else map.set(hour, [o]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, items]) => ({ hour, items }));
  }, [occurrences]);

  const currentHour = new Date(now).getHours();

  return (
    <View style={{ gap: 4 }}>
      {groups.map((group) => {
        const isNow = group.hour === currentHour;
        return (
          <View key={group.hour} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }}>
            {/* Hour gutter */}
            <View style={{ width: 62, paddingTop: 12, alignItems: 'flex-end' }}>
              <Text
                style={{
                  color: isNow ? t.accent : t.textDim,
                  fontSize: 12.5,
                  fontWeight: '800',
                  letterSpacing: 0.3,
                }}
              >
                {formatHour(group.hour)}
              </Text>
              {group.items.length > 1 ? (
                <Text style={{ color: t.textFaint, fontSize: 10.5, marginTop: 2 }}>
                  {group.items.length} tasks
                </Text>
              ) : null}
            </View>

            {/* Timeline rail */}
            <View style={{ alignItems: 'center', width: 12, paddingTop: 14 }}>
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  backgroundColor: isNow ? t.accent : t.border,
                }}
              />
              <View style={{ flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
            </View>

            {/* Every task in this hour, stacked */}
            <View style={{ flex: 1, gap: 7 }}>
              {group.items.map((o) => (
                <TaskRow
                  key={`${o.task.id}|${o.stateDate}`}
                  occurrence={o}
                  onPress={() => onPressTask(o)}
                  onLongPress={onLongPressTask ? () => onLongPressTask(o) : undefined}
                  onToggleDone={() => onToggleDone(o)}
                  onToggleStarted={() => onToggleStarted(o)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
