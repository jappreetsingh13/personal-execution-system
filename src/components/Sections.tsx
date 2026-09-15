import React from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Section } from '@/types';
import { useTheme } from '@/theme/ThemeProvider';
import { makeId } from '@/lib/id';
import { SectionTitle } from './ui';

export function makeSection(): Section {
  return { id: makeId(), title: '', body: '', collapsed: false };
}

/**
 * Named accordion blocks for links and reference material, shared by the note
 * and task editors. Collapsed state lives on the section itself so a long note
 * reopens the way it was left.
 */
export function SectionsEditor({
  sections,
  onChange,
  label = 'Extra sections',
}: {
  sections: Section[];
  onChange: (next: Section[]) => void;
  label?: string;
}) {
  const t = useTheme();

  const update = (id: string, patch: Partial<Section>) =>
    onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const remove = (id: string) => {
    const section = sections.find((s) => s.id === id);
    const name = section?.title?.trim() || 'this section';
    Alert.alert('Remove section', `Delete ${name}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => onChange(sections.filter((s) => s.id !== id)),
      },
    ]);
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <SectionTitle>{label}</SectionTitle>
        </View>
        <Pressable
          onPress={() => onChange([...sections, makeSection()])}
          hitSlop={10}
          accessibilityLabel="Add a section"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingHorizontal: 11,
            paddingVertical: 6,
            borderRadius: 9,
            backgroundColor: t.accent,
            marginBottom: 10,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="add" size={15} color={t.onAccent} />
          <Text style={{ color: t.onAccent, fontSize: 12.5, fontWeight: '800' }}>Add</Text>
        </Pressable>
      </View>

      {sections.length === 0 ? (
        <Text style={{ color: t.textFaint, fontSize: 12.5, lineHeight: 18 }}>
          Tap Add to create a titled block — handy for links, references, or anything worth keeping
          separate from the main text.
        </Text>
      ) : null}

      {sections.map((section) => (
        <View
          key={section.id}
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.border,
            borderRadius: 12,
            backgroundColor: t.surface,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 12,
              paddingRight: 6,
              backgroundColor: t.surfaceAlt,
            }}
          >
            <Pressable
              onPress={() => update(section.id, { collapsed: !section.collapsed })}
              hitSlop={8}
              accessibilityLabel={section.collapsed ? 'Expand section' : 'Collapse section'}
              style={{ paddingVertical: 12, paddingRight: 8 }}
            >
              <Ionicons
                name={section.collapsed ? 'chevron-forward' : 'chevron-down'}
                size={17}
                color={t.textDim}
              />
            </Pressable>

            <TextInput
              value={section.title}
              onChangeText={(v) => update(section.id, { title: v })}
              placeholder="Section title"
              placeholderTextColor={t.textFaint}
              keyboardAppearance={t.dark ? 'dark' : 'light'}
              style={{
                flex: 1,
                paddingVertical: 12,
                color: t.text,
                fontSize: 15,
                fontWeight: '700',
              }}
            />

            <Pressable
              onPress={() => remove(section.id)}
              hitSlop={8}
              accessibilityLabel="Delete section"
              style={{ padding: 10 }}
            >
              <Ionicons name="trash-outline" size={17} color={t.textFaint} />
            </Pressable>
          </View>

          {!section.collapsed ? (
            <TextInput
              value={section.body}
              onChangeText={(v) => update(section.id, { body: v })}
              placeholder="Links, notes, anything…"
              placeholderTextColor={t.textFaint}
              multiline
              keyboardAppearance={t.dark ? 'dark' : 'light'}
              textAlignVertical="top"
              style={{
                padding: 13,
                minHeight: 92,
                color: t.text,
                fontSize: 15,
                lineHeight: 21,
              }}
            />
          ) : section.body.trim() ? (
            <Text
              numberOfLines={1}
              style={{ color: t.textFaint, fontSize: 12.5, paddingHorizontal: 13, paddingVertical: 10 }}
            >
              {section.body.trim()}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
