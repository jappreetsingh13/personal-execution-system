import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Importance } from '@/types';
import { IMPORTANCE_COLORS, IMPORTANCE_LABELS, IMPORTANCE_VALUES } from '@/theme/themes';
import { useTheme } from '@/theme/ThemeProvider';

/** The 5 importance marks, shared by the note and task editors. */
export function ColorPicker({
  value,
  onChange,
}: {
  value: Importance;
  onChange: (v: Importance) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {IMPORTANCE_VALUES.map((level) => {
          const selected = level === value;
          return (
            <Pressable
              key={level}
              onPress={() => onChange(level)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={IMPORTANCE_LABELS[level]}
              style={({ pressed }) => ({
                flex: 1,
                aspectRatio: 1,
                borderRadius: 12,
                backgroundColor: IMPORTANCE_COLORS[level],
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: selected ? 3 : 0,
                borderColor: t.text,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              })}
            >
              {selected ? <Ionicons name="checkmark" size={22} color="#FFFFFF" /> : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: t.textDim, fontSize: 13, fontWeight: '600' }}>
        {IMPORTANCE_LABELS[value]}
      </Text>
    </View>
  );
}

/** Small solid dot — the at-a-glance importance mark on list rows. */
export function ImportanceDot({ level, size = 10 }: { level: Importance; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: IMPORTANCE_COLORS[level],
      }}
    />
  );
}
