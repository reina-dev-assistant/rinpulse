import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { IconChip } from '@/components/IconChip';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { spacing } from '@/theme';

import { useStrengthHr } from '../useStrengthHr';

/**
 * What the heart rate strap asks of the person in the logger, once per workout: a short explanation of the Bluetooth permission with
 * "Lanjut" (only that button asks), a notice with the app settings when the permission was refused, a note when Bluetooth is off.
 * Renders nothing when no strap is paired for workouts, while the strap is fine, and after a dismissal. It is its own component: the
 * sensor state it follows changes every second, which must not redraw the workout.
 */
export function StrapCard({ workoutId }: { workoutId: string | null }) {
  const { t } = useTranslation(['strength', 'common']);
  const strap = useStrengthHr(workoutId);
  if (strap.name === null) return null;

  if (strap.bluetoothOff) return <Notice icon="bluetooth-outline">{t('strength:hr.bluetoothOff')}</Notice>;

  if (strap.prompt === 'explain') {
    return (
      <Card style={styles.card}>
        <View style={styles.head}>
          <IconChip icon="heart" tint="heart" />
          <View style={styles.text}>
            <AppText variant="bodyStrong">{t('strength:hr.ask.title')}</AppText>
            <AppText variant="caption" muted>
              {t('strength:hr.ask.body', { name: strap.name })}
            </AppText>
          </View>
        </View>
        <ButtonRow>
          <Button label={t('strength:hr.ask.skip')} variant="ghost" onPress={strap.onDismiss} />
          <Button label={t('strength:hr.ask.continue')} variant="primary" onPress={strap.onContinue} />
        </ButtonRow>
      </Card>
    );
  }

  if (strap.prompt === 'denied' || strap.prompt === 'blocked') {
    return (
      <View style={styles.denied}>
        <Notice icon="bluetooth-outline" action={{ label: t('strength:hr.denied.action'), onPress: () => void Linking.openSettings() }}>
          {t('strength:hr.denied.body')}
        </Notice>
        <Button label={t('common:actions.close')} variant="ghost" onPress={strap.onDismiss} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  denied: { gap: spacing.xs },
});
