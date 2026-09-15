import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';

export function Card({
  children,
  style,
  onPress,
  onLongPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.surface,
    borderColor: t.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
  };
  if (!onPress && !onLongPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [base, style, pressed && { opacity: 0.7 }]}
    >
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: t.textDim,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    primary: { bg: t.accent, fg: t.onAccent, border: t.accent },
    secondary: { bg: t.surfaceAlt, fg: t.text, border: t.border },
    danger: { bg: 'transparent', fg: t.danger, border: t.danger },
    ghost: { bg: 'transparent', fg: t.textDim, border: 'transparent' },
  };
  const c = palette[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: c.bg,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: 12,
          paddingVertical: 13,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={c.fg} /> : null}
      <Text style={{ color: c.fg, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  autoFocus,
  style,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 7 }}>
      {label ? <SectionTitle>{label}</SectionTitle> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.textFaint}
        multiline={multiline}
        autoFocus={autoFocus}
        keyboardAppearance={t.dark ? 'dark' : 'light'}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[
          {
            backgroundColor: t.surface,
            borderColor: t.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: t.text,
            fontSize: 16,
            minHeight: multiline ? 120 : 48,
          },
          style,
        ]}
      />
    </View>
  );
}

/** Horizontal pill selector used for recurrence, stats range, and filters. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.surfaceAlt,
        borderRadius: 12,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 9,
              borderRadius: 9,
              alignItems: 'center',
              backgroundColor: active ? t.accent : 'transparent',
              opacity: pressed && !active ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                color: active ? t.onAccent : t.textDim,
                fontWeight: '700',
                fontSize: 13,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({
  label,
  value,
  icon,
  onPress,
  right,
  danger,
}: {
  label: string;
  value?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
}) {
  const t = useTheme();
  const color = danger ? t.danger : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        opacity: pressed && onPress ? 0.6 : 1,
      })}
    >
      {icon ? <Ionicons name={icon} size={20} color={danger ? t.danger : t.textDim} /> : null}
      <Text style={{ color, fontSize: 16, fontWeight: '600', flex: 1 }}>{label}</Text>
      {value ? <Text style={{ color: t.textDim, fontSize: 15 }}>{value}</Text> : null}
      {right}
      {onPress && !right ? (
        <Ionicons name="chevron-forward" size={17} color={t.textFaint} />
      ) : null}
    </Pressable>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 32, gap: 10 }}>
      <Ionicons name={icon} size={46} color={t.textFaint} />
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
      {subtitle ? (
        <Text style={{ color: t.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

/** Floating action button, bottom-right above the tab bar. */
export function Fab({
  onPress,
  icon = 'add',
}: {
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: 18,
        // Lift clear of the phone's gesture bar / nav buttons.
        bottom: 22 + insets.bottom,
        width: 58,
        height: 58,
        borderRadius: 29,
        backgroundColor: t.accent,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.93 : 1 }],
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      })}
    >
      <Ionicons name={icon} size={29} color={t.onAccent} />
    </Pressable>
  );
}
