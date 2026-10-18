import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import type { IconName } from '@/components/IconChip';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { HIT, overlay, spacing, useColors, useTheme } from '@/theme';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Runs once the sheet has fully left the screen (iOS only; Android has no such event). */
  onDismiss?: () => void;
  children: ReactNode;
}

/** A card that slides up from the bottom over a dimmed screen. It lifts above the keyboard and scrolls when its content is tall. */
export function BottomSheet({ visible, onClose, title, onDismiss, children }: BottomSheetProps) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation('common');
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismiss} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('actions.close')} />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingBottom: insets.bottom + spacing.md },
          ]}>
          <View style={[styles.grabber, { backgroundColor: colors.hairline }]} />
          {title ? (
            <AppText variant="heading" accessibilityRole="header">
              {title}
            </AppText>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface MenuItem {
  key: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  /** A tick after the label: the current choice. */
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** One-tap actions in a bottom sheet; choosing one closes the sheet first. */
export function MenuSheet({ visible, onClose, title, items }: { visible: boolean; onClose: () => void; title?: string; items: readonly MenuItem[] }) {
  const colors = useColors();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {items.map((item) => (
        <PressableScale
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ disabled: !!item.disabled, selected: !!item.selected }}
          disabled={item.disabled}
          scaleTo={0.985}
          onPress={() => {
            onClose();
            item.onPress();
          }}
          style={styles.item}>
          <Ionicons name={item.icon} size={22} color={item.danger ? colors.destructive : colors.foreground} />
          <AppText variant="bodyStrong" danger={item.danger} style={styles.itemLabel}>
            {item.label}
          </AppText>
          {item.selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
        </PressableScale>
      ))}
    </BottomSheet>
  );
}

interface TextPromptProps {
  visible: boolean;
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  multiline?: boolean;
  numeric?: boolean;
  /** An empty answer is allowed (a note can be cleared). */
  allowEmpty?: boolean;
  onConfirm: (text: string) => void;
  onClose: () => void;
}

/** A sheet with one text field and a confirm button. */
export function TextPrompt({ visible, title, label, initial = '', placeholder, confirmLabel, multiline, numeric, allowEmpty, onConfirm, onClose }: TextPromptProps) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);
  const ready = allowEmpty || text.trim().length > 0;
  const submit = () => {
    if (!ready) return;
    onClose();
    onConfirm(text.trim());
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <Input
        accessibilityLabel={label}
        placeholder={placeholder ?? label}
        value={text}
        onChangeText={setText}
        autoFocus
        selectTextOnFocus
        multiline={multiline}
        keyboardType={numeric ? 'number-pad' : 'default'}
        returnKeyType={multiline ? 'default' : 'done'}
        onSubmitEditing={multiline ? undefined : submit}
        style={multiline ? styles.multiline : undefined}
      />
      <Button label={confirmLabel} variant="primary" disabled={!ready} onPress={submit} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: overlay.scrim },
  sheet: { maxHeight: '88%', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: spacing.xs },
  body: { gap: spacing.sm, paddingBottom: spacing.sm },
  item: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemLabel: { flex: 1 },
  multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: spacing.sm },
});
