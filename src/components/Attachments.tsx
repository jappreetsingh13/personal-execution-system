import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { Attachment } from '@/types';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, SectionTitle } from '@/components/ui';
import {
  deleteAttachmentFiles,
  formatBytes,
  openAttachment,
  saveFileAttachments,
  saveImageAttachments,
} from '@/lib/attachments';

/**
 * Photos and files on a task. Everything picked is copied into app storage
 * immediately (see lib/attachments.ts), so the list is safe to persist as-is.
 */
export function AttachmentsEditor({
  attachments,
  onChange,
}: {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);

  const addPhotos = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.8,
      });
      if (result.canceled || result.assets.length === 0) return;
      const saved = await saveImageAttachments(result.assets);
      if (saved.length > 0) onChange([...attachments, ...saved]);
    } catch (err) {
      console.warn('[attachments] photo pick failed', err);
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true });
      if (result.canceled || !result.assets?.length) return;
      const saved = await saveFileAttachments(result.assets);
      if (saved.length > 0) onChange([...attachments, ...saved]);
    } catch (err) {
      console.warn('[attachments] file pick failed', err);
    } finally {
      setBusy(false);
    }
  };

  const remove = (attachment: Attachment) => {
    onChange(attachments.filter((a) => a.id !== attachment.id));
    // The copy is orphaned the moment it leaves the list — delete it now, while
    // we still know which file it was.
    void deleteAttachmentFiles([attachment]);
  };

  const images = attachments.filter((a) => a.kind === 'image');
  const files = attachments.filter((a) => a.kind !== 'image');

  return (
    <View style={{ gap: 10 }}>
      <SectionTitle>Attachments</SectionTitle>
      <Card style={{ paddingHorizontal: 15, paddingVertical: 13, gap: 12 }}>
        {attachments.length === 0 ? (
          <Text style={{ color: t.textDim, fontSize: 13, lineHeight: 18 }}>
            Photos and files live on this task. They are copied into the app, so they stay even if
            the original is deleted.
          </Text>
        ) : null}

        {images.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {images.map((a) => (
              <View key={a.id}>
                <Pressable onPress={() => setPreview(a)} style={{ borderRadius: 10, overflow: 'hidden' }}>
                  <Image source={{ uri: a.uri }} style={{ width: 84, height: 84 }} resizeMode="cover" />
                </Pressable>
                <Pressable
                  onPress={() => remove(a)}
                  hitSlop={6}
                  accessibilityLabel={`Remove ${a.name}`}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: t.surface,
                    borderWidth: 1,
                    borderColor: t.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="close" size={14} color={t.text} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {files.map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable
              onPress={() => openAttachment(a)}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 8,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons
                name={a.mimeType?.startsWith('audio/') ? 'musical-notes-outline' : 'document-outline'}
                size={20}
                color={t.accent}
              />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: t.text, fontSize: 14.5, fontWeight: '600' }}>
                  {a.name}
                </Text>
                <Text style={{ color: t.textDim, fontSize: 12, marginTop: 1 }}>
                  {formatBytes(a.size) ?? 'Tap to open'}
                </Text>
              </View>
            </Pressable>
            <Pressable onPress={() => remove(a)} hitSlop={8} accessibilityLabel={`Remove ${a.name}`}>
              <Ionicons name="close-circle" size={19} color={t.textFaint} />
            </Pressable>
          </View>
        ))}

        <View style={{ flexDirection: 'row', gap: 9 }}>
          <AddButton
            label="Add photos"
            icon="image-outline"
            onPress={() => void addPhotos()}
            disabled={busy}
          />
          <AddButton
            label="Add files"
            icon="attach-outline"
            onPress={() => void addFiles()}
            disabled={busy}
          />
        </View>
      </Card>

      {/* Full-screen image preview. */}
      <Modal visible={preview != null} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: '#000000EE', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => setPreview(null)}
        >
          {preview ? (
            <>
              <Image
                source={{ uri: preview.uri }}
                style={{ width: '92%', height: '78%' }}
                resizeMode="contain"
              />
              <Text numberOfLines={1} style={{ color: '#fff', fontSize: 13, marginTop: 12, paddingHorizontal: 24 }}>
                {preview.name}
              </Text>
              <Text style={{ color: '#ffffff99', fontSize: 12, marginTop: 6 }}>Tap anywhere to close</Text>
            </>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function AddButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingVertical: 11,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.surfaceAlt,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={17} color={t.accent} />
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}
