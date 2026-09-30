import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Importance, Note } from '@/types';
import { useNotesStore, sortNotes } from '@/store/useNotesStore';
import { useTasksStore } from '@/store/useTasksStore';
import { IMPORTANCE_COLORS } from '@/theme/themes';
import { useTheme } from '@/theme/ThemeProvider';
import { EmptyState, Fab } from '@/components/ui';
import { ImportanceFilter } from '@/components/ImportanceFilter';
import { Sheet } from '@/components/Sheet';
import { TabHeader, HeaderCount } from '@/components/TabHeader';
import { useShareSheet } from '@/components/ShareSheet';
import { formatRelativeDay, toKey } from '@/lib/date';
import { noteDoc } from '@/lib/export';

export default function NotesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const notes = useNotesStore((s) => s.notes);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const togglePinned = useNotesStore((s) => s.togglePinned);
  const unlinkNote = useTasksStore((s) => s.unlinkNote);
  const tasks = useTasksStore((s) => s.tasks);

  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState<Set<Importance>>(new Set());

  const visible = useMemo(() => {
    const all = sortNotes(Object.values(notes));
    const q = query.trim().toLowerCase();
    return all.filter((n) => {
      if (levels.size > 0 && !levels.has(n.importance)) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.sections.some(
          (s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
        )
      );
    });
  }, [notes, query, levels]);

  const share = useShareSheet();
  const [menuNote, setMenuNote] = useState<Note | null>(null);

  const confirmDelete = (note: Note) => {
    Alert.alert(
      'Delete note',
      `Delete "${note.title || 'Untitled'}"? Once deleted it's gone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            unlinkNote(note.id);
            deleteNote(note.id);
          },
        },
      ],
    );
  };

  const openMenu = (note: Note) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuNote(note);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <TabHeader
        title="Notes"
        right={<HeaderCount shown={visible.length} total={Object.keys(notes).length} />}
      />

      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            backgroundColor: t.surface,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.border,
            paddingHorizontal: 13,
          }}
        >
          <Ionicons name="search" size={17} color={t.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search notes"
            placeholderTextColor={t.textFaint}
            keyboardAppearance={t.dark ? 'dark' : 'light'}
            style={{ flex: 1, paddingVertical: 11, color: t.text, fontSize: 15.5 }}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={t.textFaint} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ paddingBottom: 12 }}>
        <ImportanceFilter selected={levels} onChange={setLevels} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{
          padding: 16,
          paddingTop: 4,
          // Clears the FAB and the phone's own nav bar.
          paddingBottom: insets.bottom + 120,
          gap: 10,
        }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <NoteCard
            note={item}
            linkedCount={item.linkedTaskIds.filter((id) => tasks[id]).length}
            onPress={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })}
            onLongPress={() => openMenu(item)}
          />
        )}
        ListEmptyComponent={
          query || levels.size > 0 ? (
            <EmptyState
              icon="search-outline"
              title="No matches"
              subtitle="Try a different search, or clear the importance filter."
            />
          ) : (
            <EmptyState
              icon="document-text-outline"
              title="No notes yet"
              subtitle="Notes live here until you delete them — no dates, no expiry. Tap + to write one."
            />
          )
        }
      />

      <Fab onPress={() => router.push({ pathname: '/note/[id]', params: { id: 'new' } })} />

      <Sheet
        visible={menuNote != null}
        title={menuNote?.title || 'Untitled'}
        onClose={() => setMenuNote(null)}
        actions={
          menuNote
            ? [
                {
                  label: 'Share',
                  hint: 'As text, PDF or Word',
                  icon: 'share-outline',
                  onPress: () => share.open(noteDoc(menuNote, tasks)),
                },
                {
                  label: menuNote.pinned ? 'Unpin' : 'Pin to top',
                  icon: menuNote.pinned ? 'remove-circle-outline' : 'pin-outline',
                  onPress: () => togglePinned(menuNote.id),
                },
                {
                  label: 'Delete',
                  hint: "Once deleted it's gone",
                  icon: 'trash-outline',
                  destructive: true,
                  onPress: () => confirmDelete(menuNote),
                },
              ]
            : []
        }
      />

      {share.element}
    </View>
  );
}

function NoteCard({
  note,
  linkedCount,
  onPress,
  onLongPress,
}: {
  note: Note;
  linkedCount: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const t = useTheme();
  const preview = note.body.trim().replace(/\s+/g, ' ');

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
      <View style={{ width: 6, backgroundColor: IMPORTANCE_COLORS[note.importance] }} />
      <View style={{ flex: 1, padding: 14, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {note.pinned ? <Ionicons name="pin" size={14} color={t.accent} /> : null}
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: '700' }}>
            {note.title || 'Untitled'}
          </Text>
        </View>
        {preview ? (
          <Text numberOfLines={2} style={{ color: t.textDim, fontSize: 14, lineHeight: 19 }}>
            {preview}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
          <Text style={{ color: t.textFaint, fontSize: 11.5 }}>
            {formatRelativeDay(toKey(new Date(note.updatedAt)))}
          </Text>
          {note.sections.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="layers-outline" size={12} color={t.textFaint} />
              <Text style={{ color: t.textFaint, fontSize: 11.5 }}>{note.sections.length}</Text>
            </View>
          ) : null}
          {linkedCount > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="link" size={12} color={t.accent} />
              <Text style={{ color: t.accent, fontSize: 11.5 }}>
                {linkedCount} task{linkedCount === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
