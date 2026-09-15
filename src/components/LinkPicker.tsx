import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Importance } from '@/types';
import { IMPORTANCE_COLORS } from '@/theme/themes';
import { useTheme } from '@/theme/ThemeProvider';
import { SectionTitle } from './ui';

export type LinkOption = {
  id: string;
  title: string;
  subtitle?: string;
  importance: Importance;
};

/**
 * Multi-select list for wiring notes to tasks and back.
 *
 * Both directions use this same component, which is what makes the
 * relationship genuinely many-to-many from either side rather than one
 * privileged side owning the link.
 */
export function LinkPicker({
  label,
  emptyLabel,
  options,
  selectedIds,
  onChange,
  onOpen,
}: {
  label: string;
  emptyLabel: string;
  options: LinkOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Tapping an already-linked chip navigates to it. */
  onOpen?: (id: string) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => selectedIds.map((id) => options.find((o) => o.id === id)).filter(Boolean) as LinkOption[],
    [selectedIds, options],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.title.toLowerCase().includes(q) || (o.subtitle ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    );
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <SectionTitle>
            {label}
            {selected.length > 0 ? ` · ${selected.length}` : ''}
          </SectionTitle>
        </View>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          disabled={options.length === 0}
          hitSlop={10}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingHorizontal: 11,
            paddingVertical: 6,
            borderRadius: 9,
            borderWidth: 1,
            borderColor: options.length === 0 ? t.border : t.accent,
            marginBottom: 10,
            opacity: options.length === 0 ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <Ionicons
            name={open ? 'chevron-up' : 'link-outline'}
            size={14}
            color={options.length === 0 ? t.textFaint : t.accent}
          />
          <Text
            style={{
              color: options.length === 0 ? t.textFaint : t.accent,
              fontSize: 12.5,
              fontWeight: '800',
            }}
          >
            {open ? 'Done' : 'Link'}
          </Text>
        </Pressable>
      </View>

      {selected.length === 0 && !open ? (
        <Text style={{ color: t.textFaint, fontSize: 12.5 }}>
          {options.length === 0 ? emptyLabel : 'Nothing linked yet.'}
        </Text>
      ) : null}

      {/* Linked chips */}
      {selected.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {selected.map((item) => (
            <View
              key={item.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                paddingLeft: 10,
                paddingRight: 6,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: t.surfaceAlt,
                borderWidth: 1,
                borderColor: t.border,
                maxWidth: '100%',
              }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: IMPORTANCE_COLORS[item.importance],
                }}
              />
              <Pressable onPress={() => onOpen?.(item.id)} disabled={!onOpen}>
                <Text
                  numberOfLines={1}
                  style={{ color: t.text, fontSize: 13, fontWeight: '600', maxWidth: 190 }}
                >
                  {item.title || 'Untitled'}
                </Text>
              </Pressable>
              <Pressable onPress={() => toggle(item.id)} hitSlop={8} style={{ padding: 2 }}>
                <Ionicons name="close-circle" size={16} color={t.textFaint} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* Picker */}
      {open ? (
        <View
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.border,
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: t.surface,
          }}
        >
          {options.length > 6 ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search…"
              placeholderTextColor={t.textFaint}
              keyboardAppearance={t.dark ? 'dark' : 'light'}
              style={{
                paddingHorizontal: 13,
                paddingVertical: 11,
                color: t.text,
                fontSize: 14.5,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: t.border,
              }}
            />
          ) : null}

          {visible.length === 0 ? (
            <Text style={{ padding: 14, color: t.textFaint, fontSize: 13 }}>No matches.</Text>
          ) : (
            visible.map((item, i) => {
              const on = selectedIds.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => toggle(item.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 11,
                    padding: 13,
                    borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: t.border,
                    backgroundColor: on ? `${t.accent}14` : 'transparent',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={on ? t.accent : t.textFaint}
                  />
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: IMPORTANCE_COLORS[item.importance],
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: t.text, fontSize: 14.5, fontWeight: '600' }}>
                      {item.title || 'Untitled'}
                    </Text>
                    {item.subtitle ? (
                      <Text style={{ color: t.textDim, fontSize: 12, marginTop: 2 }}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}
