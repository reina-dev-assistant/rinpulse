import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { FadeIn } from '@/components/motion';
import { InfoPill } from '@/components/InfoPill';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Screen';
import { isLinkUp } from '@/features/device/linkState';
import type { SetupStepId } from '@/features/setup/checklist';
import { useSetupChecklist } from '@/features/setup/useSetupChecklist';
import { HEALTH_STORE } from '@/features/sources/store';
import { useWatch } from '@/state/WatchProvider';
import { HIT, spacing, useColors } from '@/theme';

/**
 * Today: what is still missing for JoyoFit to work fully, detected from the app's own state (watch paired, first sync, the
 * Health Connect / Apple Health write, JoyoRogo sign-in, profile and step goal). Pending rows first, finished rows sink; each pending row
 * opens the screen that does it. It hides itself when every row is done, and the person can dismiss it. Nothing here is ticked by hand.
 */
export function SetupChecklistCard() {
  const checklist = useSetupChecklist();
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation('today');
  const { linkState, device, sync } = useWatch();
  if (!checklist) return null;

  const open = (id: SetupStepId) => {
    switch (id) {
      case 'pair':
        return router.push('/watch');
      case 'sync':
        // With the watch connected the row is the action; otherwise the Watch tab is where to connect.
        if (isLinkUp(linkState) && device !== null) return void sync();
        return router.push('/watch');
      case 'health':
        return router.push('/settings/health');
      case 'account':
        return router.push('/settings/akun');
      case 'profile':
        return router.push('/settings/profile');
    }
  };

  return (
    <FadeIn>
      <Card style={styles.card}>
        <View style={styles.header}>
          <AppText variant="heading" accessibilityRole="header" style={styles.title}>
            {t('setup.title')}
          </AppText>
          <InfoPill label={`${checklist.done}/${checklist.total}`} />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('setup.dismiss')}
            onPress={checklist.dismiss}
            hitSlop={4}
            style={styles.dismiss}>
            <Ionicons name="close" size={20} color={colors.mutedForeground} />
          </PressableScale>
        </View>
        {checklist.rows.map((row) => {
          const title = t(`setup.rows.${row.id}.title`, { store: HEALTH_STORE });
          const hint = t(`setup.rows.${row.id}.hint`, { store: HEALTH_STORE });
          const body = (
            <>
              <Ionicons
                name={row.done ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={row.done ? colors.linkText : colors.mutedForeground}
              />
              <View style={styles.text}>
                <AppText variant="bodyStrong" muted={row.done} numberOfLines={2}>
                  {title}
                </AppText>
                {row.done ? null : (
                  <AppText variant="caption" muted numberOfLines={2}>
                    {hint}
                  </AppText>
                )}
              </View>
              {row.done ? null : <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
            </>
          );
          return row.done ? (
            <View key={row.id} accessible accessibilityLabel={`${title}, ${t('setup.done')}`} style={styles.row}>
              {body}
            </View>
          ) : (
            <PressableScale
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={`${title}. ${hint}`}
              onPress={() => open(row.id)}
              scaleTo={0.985}
              style={styles.row}>
              {body}
            </PressableScale>
          );
        })}
      </Card>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: { gap: 0, paddingVertical: spacing.sm, paddingHorizontal: spacing.md + 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: HIT },
  title: { flex: 1 },
  dismiss: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: HIT + 8, paddingVertical: spacing.xs },
  text: { flex: 1, gap: 0 },
});
