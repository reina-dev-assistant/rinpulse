import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import type { IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { useNoticeExpanded } from '@/features/notices/noticeStore';
import { HIT, spacing, useTheme } from '@/theme';

interface CollapsibleNoticeProps {
  /** Stable and unique per notice: the open/closed choice is remembered under it. Never rename once released. */
  id: string;
  /** The one line shown while collapsed; says what the notice is about, so it is worth opening. */
  title: string;
  icon?: IconName;
  children: ReactNode;
  /** One clear next step, shown once the notice is open. */
  action?: { label: string; onPress: () => void };
}

/**
 * An explanatory (not an error) notice that costs one row until opened. The choice is kept per `id`, so what the person
 * opened stays open and what they never needed stays a line. Errors and anything that blocks a task keep using `Notice`.
 */
export function CollapsibleNotice({ id, title, icon = 'information-circle', children, action }: CollapsibleNoticeProps) {
  const { colors, radius } = useTheme();
  const [open, setOpen] = useNoticeExpanded(id);
  return (
    <View style={[styles.box, { backgroundColor: colors.muted, borderRadius: radius.input }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        scaleTo={0.99}
        style={styles.header}>
        <Ionicons name={icon} size={18} color={colors.mutedForeground} />
        <AppText variant="caption" color={colors.foreground} numberOfLines={open ? undefined : 1} style={styles.title}>
          {title}
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
      </PressableScale>
      {open ? (
        <View style={styles.body}>
          <AppText variant="caption" color={colors.foreground} selectable>
            {children}
          </AppText>
          {action ? <Button label={action.label} variant="ghost" onPress={action.onPress} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: HIT, paddingHorizontal: spacing.md },
  title: { flex: 1 },
  body: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
});
