import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { prepareDatabase } from '@/db/recovery';
import { spacing, useTheme } from '@/theme';

type Phase = 'preparing' | 'repairing' | 'ready' | 'failed';

/**
 * Shows its children once `joyofit.db` is ready: schema built and, when the file turned out to be damaged, repaired
 * (`prepareDatabase`). Draws nothing while the usual quick check runs, a progress screen while a repair runs, and a way to try
 * again when the repair could not finish. An error that is not about a damaged file is thrown from here, to the error screen,
 * as it was when the schema was built by the database provider.
 */
export function DatabaseGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('preparing');
  const [failure, setFailure] = useState<unknown>(null);

  const prepare = useCallback(async () => {
    setPhase('preparing');
    try {
      setPhase((await prepareDatabase(() => setPhase('repairing'))) ? 'ready' : 'failed');
    } catch (e) {
      setFailure(e);
    }
  }, []);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  if (failure !== null) throw failure;
  if (phase === 'ready') return <>{children}</>;
  if (phase === 'preparing') return null;
  return <RepairScreen failed={phase === 'failed'} onRetry={() => void prepare()} />;
}

function RepairScreen({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation('common');
  const { colors } = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {failed ? null : <ActivityIndicator color={colors.primary} />}
      <AppText variant="heading" style={styles.centered} accessibilityRole="header">
        {failed ? t('dbRecovery.failedTitle') : t('dbRecovery.repairingTitle')}
      </AppText>
      <AppText variant="caption" muted style={styles.centered} accessibilityLiveRegion="polite">
        {failed ? t('dbRecovery.failedBody') : t('dbRecovery.repairingBody')}
      </AppText>
      {failed ? <Button label={t('dbRecovery.retry')} variant="primary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  centered: { textAlign: 'center' },
});
