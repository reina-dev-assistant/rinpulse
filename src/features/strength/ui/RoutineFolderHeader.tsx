import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { IconAction } from '@/features/courses/IconAction';
import { fmtInt } from '@/i18n';
import { HIT, spacing, useColors } from '@/theme';

interface FolderHeaderProps {
  title: string;
  /** Routines inside. */
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  icon?: IconName;
  /** The "more" button (rename, delete); leave out for a header that has no actions (the starter routines). */
  onMenu?: () => void;
}

/** The header of a folder (or of the starter routines): chevron, icon, name, number of routines; a tap folds the list. */
export function FolderHeader({ title, count, collapsed, onToggle, icon = 'folder-outline', onMenu }: FolderHeaderProps) {
  const { t } = useTranslation('routines');
  const colors = useColors();
  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('folder.toggle', { name: title, count })}
        accessibilityState={{ expanded: !collapsed }}
        onPress={onToggle}
        scaleTo={0.985}
        style={styles.main}>
        <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={18} color={colors.mutedForeground} />
        <Ionicons name={icon} size={20} color={colors.foreground} />
        <AppText variant="heading" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
        <AppText variant="caption" muted>
          {fmtInt(count)}
        </AppText>
      </PressableScale>
      {onMenu ? <IconAction icon="ellipsis-horizontal" label={t('folder.menu', { name: title })} onPress={onMenu} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  main: { flex: 1, minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexShrink: 1 },
});
