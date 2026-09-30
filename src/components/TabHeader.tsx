import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The header for a root tab screen.
 *
 * The tabs are a pager now (see (tabs)/_layout.tsx), and a material top-tab
 * navigator has no header options at all — so the header lives in the screen
 * instead of in `navigation.setOptions`. That is also why it is a component
 * rather than an option object: the counts on Notes/Tasks/Sketch re-render with
 * the list, and a `headerRight` callback re-rendering on every keystroke was
 * always the awkward part of the old setOptions version.
 *
 * Styling deliberately reproduces what the bottom-tabs navigator used to draw:
 * `t.bg` background, no shadow, 19pt/800 title.
 */
export function TabHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: t.bg,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: t.text,
          fontSize: 19,
          fontWeight: '800',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        {title}
      </Text>
      {right ? <View style={{ paddingRight: 16 }}>{right}</View> : null}
    </View>
  );
}

/** The "12 / 30" counter three tabs put on the right of their header. */
export function HeaderCount({ shown, total }: { shown: number; total: number }) {
  const t = useTheme();
  return (
    <Text style={{ color: t.textDim, fontSize: 13, fontWeight: '600' }}>
      {shown}
      {shown !== total ? ` / ${total}` : ''}
    </Text>
  );
}

/** Hairline under a header, for screens whose content scrolls straight into it. */
export function HeaderRule() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}
