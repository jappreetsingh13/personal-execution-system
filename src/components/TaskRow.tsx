import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { Occurrence } from '@/types';
import { IMPORTANCE_COLORS, OVERDUE_COLOR, STATUS_COLORS, STATUS_LABELS } from '@/theme/themes';
import { useTheme } from '@/theme/ThemeProvider';
import { formatShortDate, formatTime } from '@/lib/date';

/**
 * One task on one day. The checkbox and Start button both act on this single
 * occurrence, never the whole recurring task — ticking Monday leaves Tuesday
 * untouched.
 */
export function TaskRow({
  occurrence,
  onPress,
  onLongPress,
  onToggleDone,
  onToggleStarted,
  showDate,
}: {
  occurrence: Occurrence;
  onPress?: () => void;
  onLongPress?: () => void;
  onToggleDone: () => void;
  onToggleStarted: () => void;
  showDate?: string;
}) {
  const t = useTheme();
  const { task, status, overdue, movedFrom } = occurrence;
  const done = status === 'done';
  const started = status === 'in_progress';

  const tap = (fn: () => void) => () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        backgroundColor: t.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.border,
        paddingVertical: 11,
        paddingRight: 12,
        paddingLeft: 0,
        overflow: 'hidden',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {/* Importance stripe */}
      <View
        style={{
          width: 5,
          alignSelf: 'stretch',
          backgroundColor: IMPORTANCE_COLORS[task.importance],
        }}
      />

      <Pressable
        onPress={tap(onToggleDone)}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`Mark ${task.title} ${done ? 'not done' : 'done'}`}
        style={{
          width: 25,
          height: 25,
          borderRadius: 7,
          borderWidth: 2,
          borderColor: done ? STATUS_COLORS.done : t.textFaint,
          backgroundColor: done ? STATUS_COLORS.done : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {done ? <Ionicons name="checkmark" size={17} color="#FFFFFF" /> : null}
      </Pressable>

      <View style={{ flex: 1, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{
            color: done ? t.textDim : t.text,
            fontSize: 15.5,
            fontWeight: '600',
            textDecorationLine: done ? 'line-through' : 'none',
          }}
        >
          {task.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <Text style={{ color: t.textDim, fontSize: 12.5, fontWeight: '600' }}>
            {formatTime(occurrence.minutes)}
          </Text>
          {showDate ? (
            <>
              <Text style={{ color: t.textFaint, fontSize: 12 }}>·</Text>
              <Text style={{ color: t.textDim, fontSize: 12.5 }}>{showDate}</Text>
            </>
          ) : null}
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 6,
              backgroundColor: `${STATUS_COLORS[status]}26`,
            }}
          >
            <Text style={{ color: STATUS_COLORS[status], fontSize: 11, fontWeight: '700' }}>
              {STATUS_LABELS[status]}
            </Text>
          </View>
          {overdue ? (
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: `${OVERDUE_COLOR}26`,
              }}
            >
              <Text style={{ color: OVERDUE_COLOR, fontSize: 11, fontWeight: '700' }}>
                Overdue
              </Text>
            </View>
          ) : null}
          {movedFrom ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name="arrow-forward" size={11} color={t.textFaint} />
              <Text style={{ color: t.textFaint, fontSize: 11 }}>
                from {formatShortDate(movedFrom)}
              </Text>
            </View>
          ) : null}
          {occurrence.task.linkedNoteIds.length > 0 ? (
            <Ionicons name="document-text-outline" size={13} color={t.textFaint} />
          ) : null}
          {occurrence.task.alarmEnabled ? (
            <Ionicons name="alarm-outline" size={13} color={t.textFaint} />
          ) : null}
        </View>
      </View>

      {/* Start toggle — the explicit signal that turns a task In Progress. */}
      {!done ? (
        <Pressable
          onPress={tap(onToggleStarted)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={started ? 'Mark not started' : 'Start task'}
          style={({ pressed }) => ({
            paddingHorizontal: 11,
            paddingVertical: 7,
            borderRadius: 9,
            borderWidth: 1,
            borderColor: started ? STATUS_COLORS.in_progress : t.border,
            backgroundColor: started ? `${STATUS_COLORS.in_progress}1F` : 'transparent',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{
              color: started ? STATUS_COLORS.in_progress : t.textDim,
              fontSize: 12,
              fontWeight: '700',
            }}
          >
            {started ? 'Started' : 'Start'}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
