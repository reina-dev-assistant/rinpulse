import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { dbHealth, useDbHealth, type RepairNotice } from '@/db/recovery';
import { radius, spacing, useTheme } from '@/theme';
import { useWatch } from '@/state/WatchProvider';

interface NoticeKeys {
  title: 'failedTitle' | 'recreatedTitle' | 'lostTitle' | 'repairedTitle' | 'repairingTitle';
  body: 'pendingBody' | 'failedBody' | 'recreatedBody' | 'lostBody' | 'repairedBody' | 'repairingBody';
}

/** Title and body of what a repair did, in the person's words; the tone is the same for every outcome: what happened, what is safe, what comes next. */
function textFor(notice: RepairNotice): NoticeKeys {
  if (notice.kind === 'failed') return { title: 'failedTitle', body: notice.pendingSwap ? 'pendingBody' : 'failedBody' };
  if (notice.kind === 'recreated') return { title: 'recreatedTitle', body: 'recreatedBody' };
  return notice.lost ? { title: 'lostTitle', body: 'lostBody' } : { title: 'repairedTitle', body: 'repairedBody' };
}

/**
 * What the repair of a damaged database did (`src/db/recovery`): a note while it runs, then what was saved and what comes back
 * from the cloud and the watch, until the person dismisses it. A failed repair says so and offers another try; the damaged file
 * is never deleted either way. After a repair the screens and the cloud sync are told the data changed, so what the cloud
 * gives back arrives without a restart.
 */
export function DbHealthNotice() {
  const { t } = useTranslation('common');
  const { colors, radius: radii } = useTheme();
  const insets = useSafeAreaInsets();
  const { dataChanged } = useWatch();
  const { repairing, notice } = useDbHealth();
  const seen = useRef<number | null>(notice?.at ?? null);

  useEffect(() => {
    if (repairing || !notice || notice.kind === 'failed' || seen.current === notice.at) return;
    seen.current = notice.at;
    dataChanged();
  }, [repairing, notice, dataChanged]);

  if (!repairing && !notice) return null;
  const failed = !repairing && notice?.kind === 'failed';
  const keys: NoticeKeys = repairing || !notice ? { title: 'repairingTitle', body: 'repairingBody' } : textFor(notice);

  return (
    <View pointerEvents="box-none" style={[styles.anchor, { paddingTop: insets.top + spacing.sm }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radii.tile }]}>
        <View style={styles.row}>
          <View style={[styles.chip, { backgroundColor: failed ? colors.destructiveSoft : colors.stepsSoft }]}>
            <Ionicons
              name={failed ? 'alert-circle' : repairing ? 'construct' : 'shield-checkmark'}
              size={22}
              color={failed ? colors.destructive : colors.stepsText}
            />
          </View>
          <View style={styles.texts}>
            <AppText variant="bodyStrong">{t(`dbRecovery.${keys.title}`)}</AppText>
            <AppText variant="caption" muted>
              {t(`dbRecovery.${keys.body}`)}
            </AppText>
          </View>
        </View>
        {repairing ? null : (
          <View style={styles.actions}>
            {failed ? <Button label={t('dbRecovery.retry')} variant="ghost" onPress={() => void dbHealth.repair()} /> : null}
            <Button label={t('dbRecovery.dismiss')} variant="primary" onPress={dbHealth.dismiss} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 95, elevation: 95, paddingHorizontal: spacing.lg },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  chip: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
