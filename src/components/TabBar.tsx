import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MaterialTopTabNavigationOptions } from 'expo-router/js-top-tabs';
import { CommonActions } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The bottom tab bar.
 *
 * The tabs are a material *top*-tab navigator now, because that is the one that
 * renders its scenes in a real pager — which is what makes the swipe follow your
 * finger. `tabBarPosition: 'bottom'` puts the bar back where it belongs, and
 * this component draws it, because the stock material bar is a top bar with an
 * indicator and no room for stacked icon + label.
 *
 * Label and icon come from each screen's own `title` / `tabBarIcon` options, so
 * (tabs)/_layout.tsx still declares them exactly as it did under bottom-tabs.
 */
/**
 * Structural stand-in for the navigator's bar props. The library's own
 * `MaterialTopTabBarProps` is declared as `any & {…}`, which collapses to `any`
 * and takes every callback's inference with it — so the bits we actually touch
 * are spelled out here instead.
 */
type Route = { key: string; name: string; params?: object };

type TabBarProps = {
  state: { key: string; index: number; routes: Route[] };
  descriptors: Record<string, { options: MaterialTopTabNavigationOptions }>;
  navigation: {
    emit(event: { type: 'tabPress'; target: string; canPreventDefault: true }): {
      defaultPrevented: boolean;
    };
    dispatch(action: object): void;
  };
};

export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.surface,
        borderTopColor: t.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        // Grow by the gesture/nav-bar inset so the labels sit above the phone's
        // own controls instead of underneath them.
        height: 62 + insets.bottom,
        paddingTop: 6,
        paddingBottom: 8 + insets.bottom,
      }}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const color = focused ? t.tabActive : t.tabInactive;
        const label = options.title ?? route.name;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              // Tapping the focused tab must not re-navigate: that would replay
              // the pager animation for no movement.
              //
              // Targeted at `state.key` rather than a bare `navigate(name)`,
              // because this navigator sits inside the root stack and an
              // untargeted action can be picked up by the parent instead. This
              // mirrors what the stock bars dispatch.
              if (!focused && !event.defaultPrevented) {
                navigation.dispatch({ ...CommonActions.navigate(route), target: state.key });
              }
            }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {options.tabBarIcon?.({ focused, color })}
            <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: '700' }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
