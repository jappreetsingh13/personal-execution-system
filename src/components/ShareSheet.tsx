import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Sheet } from './Sheet';
import { shareDoc, type Doc, type ShareFormat } from '@/lib/export';

/**
 * Format picker for sharing a note or a task.
 *
 * Exposed as a hook so each screen holds one line of state instead of duplicating the modal
 * plumbing — the caller renders `element` and calls `open(doc)`.
 */
export function useShareSheet() {
  const [doc, setDoc] = useState<Doc | null>(null);

  const open = useCallback((next: Doc) => setDoc(next), []);
  const close = useCallback(() => setDoc(null), []);

  const run = useCallback(
    (target: Doc, format: ShareFormat) => {
      // Fire and forget: the share sheet is the user's feedback, and an await here would just
      // hold the closed menu on screen.
      void (async () => {
        try {
          const ok = await shareDoc(target, format);
          if (!ok) {
            Alert.alert('Sharing unavailable', 'This device has no app that can receive the file.');
          }
        } catch (err) {
          console.warn('[share] failed', err);
          Alert.alert('Could not share', 'Something went wrong building the file. Please try again.');
        }
      })();
    },
    [],
  );

  const element = doc ? (
    <Sheet
      visible
      title={`Share "${doc.title}"`}
      subtitle="Choose a format"
      onClose={close}
      actions={[
        {
          label: 'Plain text',
          hint: '.txt — opens anywhere',
          icon: 'document-text-outline',
          onPress: () => run(doc, 'txt'),
        },
        {
          label: 'PDF',
          hint: '.pdf — formatted, fixed layout',
          icon: 'document-outline',
          onPress: () => run(doc, 'pdf'),
        },
        {
          label: 'Word',
          hint: '.docx — editable in Word or Google Docs',
          icon: 'document-attach-outline',
          onPress: () => run(doc, 'docx'),
        },
      ]}
    />
  ) : null;

  return { open, element };
}
