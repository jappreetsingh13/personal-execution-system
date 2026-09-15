import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Importance } from '@/types';
import { IMPORTANCE_COLORS, IMPORTANCE_LABELS, IMPORTANCE_VALUES } from '@/theme/themes';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Multi-select importance filter. An empty set means "show everything" rather
 * than "show nothing", so the default state needs no special casing at the
 * call site.
 */
export function ImportanceFilter({
  selected,
  onChange,
}: {
  selected: Set<Importance>;
  onChange: (next: Set<Importance>) => void;
}) {
  const t = useTheme();

  const toggle = (level: Importance) => {
    const next = new Set(selected);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    onChange(next);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16, alignItems: 'center' }}
    >
      {selected.size > 0 ? (
        <Pressable
          onPress={() => onChange(new Set())}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.surface,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="close" size={13} color={t.textDim} />
          <Text style={{ color: t.textDim, fontSize: 12, fontWeight: '700' }}>Clear</Text>
        </Pressable>
      ) : null}

      {IMPORTANCE_VALUES.map((level) => {
        const on = selected.has(level);
        const color = IMPORTANCE_COLORS[level];
        return (
          <Pressable
            key={level}
            onPress={() => toggle(level)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`Filter ${IMPORTANCE_LABELS[level]}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? color : t.border,
              backgroundColor: on ? `${color}26` : t.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }}
            />
            <Text
              style={{
                color: on ? color : t.textDim,
                fontSize: 12.5,
                fontWeight: '700',
              }}
            >
              {IMPORTANCE_LABELS[level]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
