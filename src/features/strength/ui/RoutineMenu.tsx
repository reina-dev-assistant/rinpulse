import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { HIT, overlay, spacing, useColors, useTheme } from '@/theme';

export interface MenuItem {
  key: string;
  label: string;
  icon?: IconName;
  /** A check at the end: the current choice of a picker. */
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** The rows of a menu: icon, label, optional check. 48 dp tall. */
export function MenuRows({ items }: { items: readonly MenuItem[] }) {
  const colors = useColors();
  return (
    <View>
      {items.map((item) => {
        const tone = item.destructive ? colors.destructive : colors.foreground;
        return (
          <PressableScale
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: !!item.disabled, selected: !!item.selected }}
            disabled={item.disabled}
            onPress={item.onPress}
            scaleTo={0.985}
            style={styles.row}>
            {item.icon ? <Ionicons name={item.icon} size={20} color={tone} /> : <View style={styles.noIcon} />}
            <AppText variant="bodyStrong" color={tone} style={styles.rowLabel} numberOfLines={2}>
              {item.label}
            </AppText>
            {item.selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

interface RoutineMenuProps {
  visible: boolean;
  title?: string;
  items: readonly MenuItem[];
  onClose: () => void;
}

/**
 * A bottom sheet of choices (a folder to move into, a set type, the actions of an exercise). Choosing closes the sheet first and then
 * runs the item, so the action may open a dialog or another sheet.
 */
export function RoutineMenu({ visible, title, items, onClose }: RoutineMenuProps) {
  const { t } = useTranslation('common');
  const { colors, radius } = useTheme();
  const closing = items.map((item) => ({
    ...item,
    onPress: () => {
      onClose();
      item.onPress();
    },
  }));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('actions.close')} />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
          {title ? (
            <AppText variant="heading" accessibilityRole="header" numberOfLines={2} style={styles.title}>
              {title}
            </AppText>
          ) : null}
          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
            <MenuRows items={closing} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: overlay.scrim },
  sheet: { maxHeight: '80%', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
  title: { paddingBottom: spacing.xs },
  scroll: { flexGrow: 0 },
  row: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowLabel: { flex: 1 },
  noIcon: { width: 20 },
});
