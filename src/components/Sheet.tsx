import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';

export type SheetAction = {
  label: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/**
 * Themed bottom sheet for short action menus.
 *
 * Used instead of `Alert` because Android's dialog has only three button slots — a menu with
 * Share / Shift / Delete / Cancel silently loses one. It also lets the menu carry icons and follow
 * the chosen theme, which a system dialog cannot.
 */
export function Sheet({
  visible,
  title,
  subtitle,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: '#00000077', justifyContent: 'flex-end' }}
      >
        {/* Stop taps inside the sheet from dismissing it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: t.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: t.border,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 38,
              height: 4,
              borderRadius: 2,
              backgroundColor: t.border,
              marginBottom: 10,
            }}
          />

          {title ? (
            <View style={{ paddingHorizontal: 20, paddingBottom: 10, gap: 2 }}>
              <Text numberOfLines={2} style={{ color: t.text, fontSize: 16, fontWeight: '800' }}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={{ color: t.textDim, fontSize: 13 }}>{subtitle}</Text>
              ) : null}
            </View>
          ) : null}

          {actions.map((action, i) => {
            const color = action.destructive ? t.danger : t.text;
            return (
              <Pressable
                key={action.label}
                disabled={action.disabled}
                onPress={() => {
                  onClose();
                  action.onPress();
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingHorizontal: 20,
                  paddingVertical: 15,
                  borderTopWidth: i === 0 && !title ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: t.border,
                  opacity: action.disabled ? 0.4 : pressed ? 0.6 : 1,
                })}
              >
                {action.icon ? (
                  <Ionicons
                    name={action.icon}
                    size={21}
                    color={action.destructive ? t.danger : t.textDim}
                  />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ color, fontSize: 15.5, fontWeight: '600' }}>{action.label}</Text>
                  {action.hint ? (
                    <Text style={{ color: t.textFaint, fontSize: 12.5, marginTop: 2 }}>
                      {action.hint}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}

          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({
              marginTop: 8,
              marginHorizontal: 16,
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: 'center',
              backgroundColor: t.surfaceAlt,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: t.textDim, fontSize: 15, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
