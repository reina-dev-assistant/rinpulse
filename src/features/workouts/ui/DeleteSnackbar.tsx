import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { undoPendingDelete, usePendingDelete } from '@/features/workouts/pendingDelete';
import { HIT, spacing, useTheme } from '@/theme';

/**
 * "Latihan dihapus  Urungkan" over the tab bar for the 5 seconds a deleted workout can still come back (`pendingDelete.ts`). Mounted once
 * in the root layout, so it survives the screen that started the delete closing.
 */
export function DeleteSnackbar() {
  const pending = usePendingDelete();
  const { t } = useTranslation('workouts');
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  if (pending === null) return null;
  return (
    <View pointerEvents="box-none" style={[styles.anchor, { paddingBottom: insets.bottom + 88 }]}>
      <View accessibilityLiveRegion="polite" style={[styles.bar, { backgroundColor: colors.hero, borderRadius: radius.control }]}>
        <Ionicons name="trash-outline" size={18} color={colors.heroAccent} />
        <AppText variant="label" color={colors.heroForeground} style={styles.text} numberOfLines={1}>
          {t('delete.done')}
        </AppText>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('delete.undoA11y', { sport: pending.label })}
          onPress={undoPendingDelete}
          style={styles.undo}>
          <AppText variant="bodyStrong" color={colors.heroAccent}>
            {t('delete.undo')}
          </AppText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: spacing.lg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.xs },
  text: { flexShrink: 1 },
  undo: { minHeight: HIT, minWidth: HIT, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
});
