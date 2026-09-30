import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Importance, Sketch } from '@/types';
import { sortSketches, useSketchesStore } from '@/store/useSketchesStore';
import { useNotesStore } from '@/store/useNotesStore';
import { useTasksStore } from '@/store/useTasksStore';
import { IMPORTANCE_COLORS } from '@/theme/themes';
import { useTheme } from '@/theme/ThemeProvider';
import { EmptyState, Fab } from '@/components/ui';
import { ImportanceFilter } from '@/components/ImportanceFilter';
import { Sheet } from '@/components/Sheet';
import { TabHeader, HeaderCount } from '@/components/TabHeader';
import { formatRelativeDay, toKey } from '@/lib/date';

export default function SketchScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const sketches = useSketchesStore((s) => s.sketches);
  const deleteSketch = useSketchesStore((s) => s.deleteSketch);
  const togglePinned = useSketchesStore((s) => s.togglePinned);
  const notes = useNotesStore((s) => s.notes);
  const tasks = useTasksStore((s) => s.tasks);

  const [levels, setLevels] = useState<Set<Importance>>(new Set());

  const visible = useMemo(
    () =>
      sortSketches(Object.values(sketches)).filter(
        (s) => levels.size === 0 || levels.has(s.importance),
      ),
    [sketches, levels],
  );

  const [menuSketch, setMenuSketch] = useState<Sketch | null>(null);

  const confirmDelete = (sketch: Sketch) => {
    Alert.alert(
      'Delete sketch',
      `Delete "${sketch.title || 'Untitled'}" and everything drawn on it? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteSketch(sketch.id),
        },
      ],
    );
  };

  const openMenu = (sketch: Sketch) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuSketch(sketch);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
        <TabHeader
          title="Sketch"
          right={<HeaderCount shown={visible.length} total={Object.keys(sketches).length} />}
        />

        <View style={{ paddingBottom: 12 }}>
          <ImportanceFilter selected={levels} onChange={setLevels} />
        </View>

        <FlatList
          data={visible}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{
            padding: 16,
            paddingTop: 4,
            paddingBottom: insets.bottom + 120,
            gap: 10,
          }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <SketchCard
              sketch={item}
              linkedCount={
                item.linkedNoteIds.filter((id) => notes[id]).length +
                item.linkedTaskIds.filter((id) => tasks[id]).length
              }
              onPress={() => router.push({ pathname: '/sketch/[id]', params: { id: item.id } })}
              onLongPress={() => openMenu(item)}
            />
          )}
          ListEmptyComponent={
            levels.size > 0 ? (
              <EmptyState
                icon="search-outline"
                title="Nothing at this importance"
                subtitle="Clear the filter to see the rest."
              />
            ) : (
              <EmptyState
                icon="color-palette-outline"
                title="Nothing sketched yet"
                subtitle="A big page for your stylus or finger — scribble, drop in screenshots, draw shapes. Tap + to start one."
              />
            )
          }
        />

        <Fab onPress={() => router.push({ pathname: '/sketch/[id]', params: { id: 'new' } })} />

        <Sheet
          visible={menuSketch != null}
          title={menuSketch?.title || 'Untitled'}
          onClose={() => setMenuSketch(null)}
          actions={
            menuSketch
              ? [
                  {
                    label: menuSketch.pinned ? 'Unpin' : 'Pin to top',
                    icon: menuSketch.pinned ? 'remove-circle-outline' : 'pin-outline',
                    onPress: () => togglePinned(menuSketch.id),
                  },
                  {
                    label: 'Delete',
                    hint: "Once deleted it's gone",
                    icon: 'trash-outline',
                    destructive: true,
                    onPress: () => confirmDelete(menuSketch),
                  },
                ]
              : []
          }
        />
    </View>
  );
}

function SketchCard({
  sketch,
  linkedCount,
  onPress,
  onLongPress,
}: {
  sketch: Sketch;
  linkedCount: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      style={({ pressed }) => ({
        flexDirection: 'row',
        backgroundColor: t.surface,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.border,
        overflow: 'hidden',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ width: 6, backgroundColor: IMPORTANCE_COLORS[sketch.importance] }} />
      <View style={{ flex: 1, padding: 14, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {sketch.pinned ? <Ionicons name="pin" size={14} color={t.accent} /> : null}
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: '700' }}>
            {sketch.title || 'Untitled'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
          <Text style={{ color: t.textFaint, fontSize: 11.5 }}>
            {formatRelativeDay(toKey(new Date(sketch.updatedAt)))}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="brush-outline" size={12} color={t.textFaint} />
            <Text style={{ color: t.textFaint, fontSize: 11.5 }}>{sketch.strokes.length}</Text>
          </View>
          {sketch.images.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="image-outline" size={12} color={t.textFaint} />
              <Text style={{ color: t.textFaint, fontSize: 11.5 }}>{sketch.images.length}</Text>
            </View>
          ) : null}
          {linkedCount > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="link" size={12} color={t.accent} />
              <Text style={{ color: t.accent, fontSize: 11.5 }}>{linkedCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
