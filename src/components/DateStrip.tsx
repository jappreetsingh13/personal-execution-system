import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { DateKey } from '@/types';
import { useTheme } from '@/theme/ThemeProvider';
import { addDays, eachDay, formatMonthLabel, fromKey, todayKey, WEEKDAY_SHORT } from '@/lib/date';

const BEHIND = 30;
const AHEAD = 60;
const ITEM_W = 52;
const GAP = 8;

/**
 * Horizontal day picker. Runs 30 days back so missed tasks stay reachable by
 * scrolling, with the calendar icon in the header for bigger jumps.
 */
export function DateStrip({
  selected,
  onSelect,
  markedDates,
}: {
  selected: DateKey;
  onSelect: (d: DateKey) => void;
  /** Dates that have at least one task, for the dot indicator. */
  markedDates: Set<DateKey>;
}) {
  const t = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const today = todayKey();

  const days = useMemo(() => eachDay(addDays(today, -BEHIND), addDays(today, AHEAD)), [today]);
  const selectedIndex = days.indexOf(selected);

  // Keep the chosen day centred, including when it changes from the calendar
  // picker rather than from a tap in this strip.
  useEffect(() => {
    if (selectedIndex < 0) return;
    const x = Math.max(0, selectedIndex * (ITEM_W + GAP) - 140);
    const id = setTimeout(() => scrollRef.current?.scrollTo({ x, animated: true }), 60);
    return () => clearTimeout(id);
  }, [selectedIndex]);

  return (
    <View>
      {/* The month of the day being viewed, so a strip of bare numbers always
          has an anchor. Follows the selection, including calendar jumps. */}
      <Text
        style={{
          color: t.textDim,
          fontSize: 11.5,
          fontWeight: '800',
          letterSpacing: 1,
          textTransform: 'uppercase',
          paddingHorizontal: 20,
          paddingBottom: 6,
        }}
      >
        {formatMonthLabel(selected)}
      </Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: GAP }}
      >
      {days.map((day) => {
        const d = fromKey(day);
        const isToday = day === today;
        const isSelected = day === selected;

        /**
         * Today always keeps its filled accent, even while you are browsing
         * another day — losing it made it hard to find your way back. The day
         * you are *viewing* is shown as a thick outline instead, so the two
         * states are legible at the same time and never compete.
         */
        const filled = isToday;
        const outlined = isSelected && !isToday;

        const fg = filled ? t.onAccent : outlined ? t.accent : t.text;

        return (
          <Pressable
            key={day}
            onPress={() => onSelect(day)}
            accessibilityLabel={`${day}${isToday ? ', today' : ''}${
              isSelected ? ', selected' : ''
            }`}
            style={({ pressed }) => ({
              width: ITEM_W,
              paddingVertical: 9,
              borderRadius: 13,
              alignItems: 'center',
              gap: 3,
              backgroundColor: filled ? t.accent : outlined ? `${t.accent}1A` : t.surface,
              borderWidth: outlined ? 2 : 1,
              borderColor: outlined ? t.accent : filled ? t.accent : t.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                color: filled ? t.onAccent : outlined ? t.accent : t.textDim,
                fontSize: 11,
                fontWeight: '700',
              }}
            >
              {WEEKDAY_SHORT[d.getDay()]}
            </Text>
            <Text style={{ color: fg, fontSize: 16.5, fontWeight: '800' }}>{d.getDate()}</Text>
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: markedDates.has(day)
                  ? filled
                    ? t.onAccent
                    : t.accent
                  : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
      </ScrollView>
    </View>
  );
}
