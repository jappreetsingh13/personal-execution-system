import React from 'react';
import { Dimensions } from 'react-native';
import { TopTabs } from 'expo-router/js-top-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { TabBar } from '@/components/TabBar';

/** The navigator's option types bottom out in `any`, so spell the icon args out. */
type IconArgs = { focused: boolean; color: string };

/**
 * The five tabs, as a pager.
 *
 * This is a material *top*-tab navigator pinned to the bottom, not a bottom-tab
 * navigator, and the reason is the swipe. A bottom-tab navigator renders one
 * scene at a time, so the old hand-rolled gesture could only wait for your
 * finger to lift and then jump. A top-tab navigator renders its scenes in a
 * pager — ViewPager2 on Android — so the content tracks your finger, the
 * neighbouring tab is visible mid-drag, and the release settles with the same
 * physics as every other Android app.
 *
 * Two consequences handled here:
 *  - This navigator has no header options, so each screen renders its own
 *    <TabHeader> (see src/components/TabHeader.tsx).
 *  - The stock material bar is a top bar with an indicator, so the bar is ours
 *    (see src/components/TabBar.tsx). Titles and icons are still declared per
 *    screen below, exactly as they were.
 *
 * `backBehavior: 'none'` is load-bearing: without it the tab router swallows the
 * Android back button to walk back through tab history, and back on a tab would
 * never close the app.
 */
export default function TabsLayout() {
  const t = useTheme();

  return (
    <TopTabs
      tabBar={TabBar}
      tabBarPosition="bottom"
      backBehavior="none"
      // Lets the pager lay its pages out correctly on the very first frame
      // instead of measuring, which otherwise shows as a blank first paint.
      initialLayout={{ width: Dimensions.get('window').width }}
      screenOptions={{
        sceneStyle: { backgroundColor: t.bg },
        swipeEnabled: true,
      }}
    >
      <TopTabs.Screen
        name="index"
        options={{
          title: 'Notes',
          tabBarIcon: ({ color }: IconArgs) => (
            <Ionicons name="document-text-outline" size={23} color={color} />
          ),
        }}
      />
      <TopTabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color }: IconArgs) => (
            <Ionicons name="checkbox-outline" size={23} color={color} />
          ),
        }}
      />
      <TopTabs.Screen
        name="sketch"
        options={{
          title: 'Sketch',
          tabBarIcon: ({ color }: IconArgs) => (
            <Ionicons name="color-palette-outline" size={23} color={color} />
          ),
        }}
      />
      <TopTabs.Screen
        name="stats"
        options={{
          title: 'Statistics',
          tabBarIcon: ({ color }: IconArgs) => (
            <Ionicons name="stats-chart-outline" size={23} color={color} />
          ),
        }}
      />
      <TopTabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }: IconArgs) => (
            <Ionicons name="settings-outline" size={23} color={color} />
          ),
        }}
      />
    </TopTabs>
  );
}
