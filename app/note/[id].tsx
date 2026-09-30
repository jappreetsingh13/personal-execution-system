import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment, Importance, Section } from '@/types';
import { useNotesStore } from '@/store/useNotesStore';
import { useTasksStore } from '@/store/useTasksStore';
import { useTheme } from '@/theme/ThemeProvider';
import { ColorPicker } from '@/components/ColorPicker';
import { LinkPicker, type LinkOption } from '@/components/LinkPicker';
import { SectionsEditor } from '@/components/Sections';
import { AttachmentsEditor } from '@/components/Attachments';
import { useShareSheet } from '@/components/ShareSheet';
import { Button, Field, SectionTitle } from '@/components/ui';
import { formatTime } from '@/lib/date';
import { noteDoc } from '@/lib/export';
import { readImportedDocument } from '@/lib/importDoc';
import { defaultContextDate, describeRecurrence } from '@/lib/recurrence';

export default function NoteEditor() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const note = useNotesStore((s) => (isNew ? undefined : s.notes[id]));
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);
  const unlinkNote = useTasksStore((s) => s.unlinkNote);
  const syncLinksFromNote = useTasksStore((s) => s.syncLinksFromNote);
  const tasks = useTasksStore((s) => s.tasks);

  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [importance, setImportance] = useState<Importance>(note?.importance ?? 1);
  const [linkedTaskIds, setLinkedTaskIds] = useState<string[]>(note?.linkedTaskIds ?? []);
  const [sections, setSections] = useState<Section[]>(note?.sections ?? []);
  const [attachments, setAttachments] = useState<Attachment[]>(note?.attachments ?? []);

  /** Suppresses the auto-save when leaving because the note was deleted. */
  const abandoned = useRef(false);
  /** Id of the note created by a first auto-save, so we update not duplicate. */
  const createdId = useRef<string | null>(null);

  const taskOptions = useMemo<LinkOption[]>(
    () =>
      Object.values(tasks)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((task) => ({
          id: task.id,
          title: task.title,
          subtitle: `${formatTime(task.minutes)} · ${describeRecurrence(task.recurrence)}`,
          importance: task.importance,
        })),
    [tasks],
  );

  const hasContent =
    title.trim().length > 0 ||
    body.trim().length > 0 ||
    sections.some((s) => s.title.trim() || s.body.trim()) ||
    attachments.length > 0;

  /**
   * Auto-save on the way out. Keeping this in a ref-read closure rather than a
   * dependency-tracked effect means the beforeRemove handler always sees the
   * latest field values without re-subscribing on every keystroke.
   */
  const latest = useRef({ title, body, importance, linkedTaskIds, sections, attachments, hasContent });
  latest.current = { title, body, importance, linkedTaskIds, sections, attachments, hasContent };

  const persist = useCallback(() => {
    if (abandoned.current) return;
    const cur = latest.current;
    if (!cur.hasContent) return;

    const payload = {
      title: cur.title.trim(),
      body: cur.body,
      importance: cur.importance,
      linkedTaskIds: cur.linkedTaskIds,
      sections: cur.sections,
      attachments: cur.attachments,
    };

    let targetId: string;
    if (isNew) {
      if (createdId.current) {
        updateNote(createdId.current, payload);
        targetId = createdId.current;
      } else {
        targetId = addNote(payload);
        createdId.current = targetId;
      }
    } else {
      updateNote(id, payload);
      targetId = id;
    }

    // Mirror onto the tasks so the link reads the same from their side.
    syncLinksFromNote(targetId, cur.linkedTaskIds);
  }, [isNew, id, addNote, updateNote, syncLinksFromNote]);

  // Save whenever this screen is being popped — back button, gesture or header.
  React.useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => persist());
    return unsub;
  }, [navigation, persist]);

  const confirmDelete = () => {
    Alert.alert('Delete note', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          abandoned.current = true;
          const target = isNew ? createdId.current : id;
          if (target) {
            unlinkNote(target);
            deleteNote(target);
          }
          router.back();
        },
      },
    ]);
  };

  const share = useShareSheet();

  /**
   * Import a .txt/.md/.docx file: its whole content lands in the note body and
   * nothing else is touched. The title picks up the first 35 characters — but
   * only when the title is still empty, so an import never silently renames a
   * note you had already named. Verify both after importing.
   */
  const importFromFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/*', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const { title: importedTitle, body } = await readImportedDocument(result.assets[0]);
      setBody((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${body}` : body));
      if (!title.trim()) setTitle(importedTitle);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      Alert.alert(
        'Could not import',
        code === 'UNSUPPORTED'
          ? 'Only text files (.txt, .md) and Word documents (.docx) can be imported.'
          : code === 'EMPTY'
            ? 'That file has no readable text.'
            : 'The file could not be read. Try exporting it as .txt or .docx.',
      );
    }
  };

  /** Share what is on screen right now, not the last saved copy. */
  const openShare = useCallback(() => {
    const cur = latest.current;
    share.open(
      noteDoc(
        {
          id: isNew ? 'draft' : id,
          title: cur.title,
          body: cur.body,
          importance: cur.importance,
          linkedTaskIds: cur.linkedTaskIds,
          sections: cur.sections,
          attachments: cur.attachments,
          createdAt: note?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        },
        tasks,
      ),
    );
  }, [share, isNew, id, note?.createdAt, tasks]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isNew ? 'New note' : 'Edit note',
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 }}>
          {hasContent ? (
            <Text style={{ color: t.textFaint, fontSize: 12.5 }}>Saves automatically</Text>
          ) : null}
          <Pressable
            onPress={openShare}
            disabled={!hasContent}
            hitSlop={10}
            accessibilityLabel="Share note"
            style={({ pressed }) => ({ padding: 8, opacity: !hasContent ? 0.35 : pressed ? 0.6 : 1 })}
          >
            <Ionicons name="share-outline" size={21} color={t.accent} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, isNew, hasContent, t, openShare]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 20,
          paddingBottom: insets.bottom + 48,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Note title"
          autoFocus={isNew}
        />
        <Field
          label="Note"
          value={body}
          onChangeText={setBody}
          placeholder="Write anything…"
          multiline
        />

        {/* Import — everything from the file goes into the body above. */}
        <View style={{ gap: 8, marginTop: -10 }}>
          <Pressable
            onPress={() => void importFromFile()}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              alignSelf: 'flex-start',
              paddingHorizontal: 13,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: t.surfaceAlt,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="download-outline" size={16} color={t.accent} />
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 13.5 }}>
              Import from file
            </Text>
          </Pressable>
          <Text style={{ color: t.textDim, fontSize: 12, lineHeight: 17 }}>
            .txt, .md or .docx — all of the content goes into the note body, and the title takes
            the first 35 characters when the note has none yet.
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <SectionTitle>Importance</SectionTitle>
          <ColorPicker value={importance} onChange={setImportance} />
        </View>

        <SectionsEditor sections={sections} onChange={setSections} />

        <AttachmentsEditor attachments={attachments} onChange={setAttachments} />

        <LinkPicker
          label="Linked tasks"
          emptyLabel="No tasks to link yet."
          options={taskOptions}
          selectedIds={linkedTaskIds}
          onChange={setLinkedTaskIds}
          onOpen={(taskId) => {
            // Always name the day. Without it the task editor falls back to today, which for a
            // task that ran yesterday means "Not Started, Overdue" instead of the Done you left.
            const target = tasks[taskId];
            router.push({
              pathname: '/task/[id]',
              params: target
                ? { id: taskId, date: defaultContextDate(target) }
                : { id: taskId },
            });
          }}
        />

        {!isNew || createdId.current ? (
          <Button
            label="Delete note"
            icon="trash-outline"
            variant="danger"
            onPress={confirmDelete}
          />
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, opacity: 0.7 }}>
          <Ionicons name="cloud-done-outline" size={14} color={t.textFaint} />
          <Text style={{ color: t.textFaint, fontSize: 12 }}>
            Changes save when you go back.
          </Text>
        </View>
      </ScrollView>

      {share.element}
    </KeyboardAvoidingView>
  );
}
