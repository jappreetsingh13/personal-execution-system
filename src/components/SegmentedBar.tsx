import React from 'react';
import { View } from 'react-native';
import { STATUS_COLORS, STATUS_ORDER } from '@/theme/themes';
import { useTheme } from '@/theme/ThemeProvider';
import type { StatusCounts } from '@/lib/status';

/**
 * The phone-storage-style bar: one horizontal line split into the 4 statuses,
 * proportional to their counts.
 */
export function SegmentedBar({ counts, height = 18 }: { counts: StatusCounts; height?: number }) {
  const t = useTheme();
  const segments = STATUS_ORDER.filter((s) => counts[s] > 0);

  if (counts.total === 0) {
    return (
      <View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: t.surfaceAlt,
          borderWidth: 1,
          borderColor: t.border,
        }}
      />
    );
  }

  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        overflow: 'hidden',
        flexDirection: 'row',
        backgroundColor: t.surfaceAlt,
      }}
    >
      {segments.map((status, i) => (
        <View
          key={status}
          style={{
            flex: counts[status],
            backgroundColor: STATUS_COLORS[status],
            // Hairline separators keep adjacent segments legible when two
            // similar colours land next to each other.
            borderRightWidth: i < segments.length - 1 ? 1.5 : 0,
            borderRightColor: t.bg,
          }}
        />
      ))}
    </View>
  );
}
