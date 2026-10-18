import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { SwitchRow } from '@/components/SwitchRow';
import { formatElapsed } from '@/features/workouts/summary';
import { fmtDistance, fmtInt } from '@/i18n';
import { overlay, spacing, useTheme } from '@/theme';

import type { LiveStats } from '../recorder';

interface FinishDialogProps {
  visible: boolean;
  live: LiveStats | null;
  /** An account is connected: the dialog offers to send the workout there. */
  stravaAvailable: boolean;
  strava: boolean;
  onStrava: (on: boolean) => void;
  /** The workout is being saved: both choices stop answering. */
  busy: boolean;
  onSave: () => void;
  onResume: () => void;
  onDiscard: () => void;
}

/** What the workout came to, with the three ways out: save it, keep going, throw it away (which asks once more). Back or a tap outside keeps going. */
export function FinishDialog({ visible, live, stravaAvailable, strava, onStrava, busy, onSave, onResume, onDiscard }: FinishDialogProps) {
  const { t } = useTranslation(['workouts', 'common']);
  const { colors, radius } = useTheme();
  const close = busy ? () => {} : onResume;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel={t('record.finish.resume')}>
        {/* A press on the card itself must not reach the scrim. */}
        <Pressable
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radius.card }]}
          onPress={() => {}}>
          <AppText variant="heading" accessibilityRole="header">
            {t('record.finish.title')}
          </AppText>
          {live ? (
            <View style={styles.summary}>
              <KeyValue icon="time-outline" label={t('record.finish.time')} value={formatElapsed(live.movingSec)} />
              <KeyValue icon="trail-sign-outline" label={t('record.finish.distance')} value={fmtDistance(live.distanceM)} />
              <KeyValue icon="flame-outline" label={t('record.finish.calories')} value={t('common:units.kcal', { value: fmtInt(live.calories) })} />
            </View>
          ) : null}
          {stravaAvailable ? (
            <SwitchRow icon="share-social-outline" label={t('record.finish.strava')} hint={t('record.finish.stravaHint')} value={strava} onValueChange={onStrava} disabled={busy} />
          ) : null}
          <View style={styles.actions}>
            <Button label={t('record.finish.save')} variant="primary" icon="checkmark" loading={busy} onPress={onSave} />
            <Button label={t('record.finish.resume')} icon="play" disabled={busy} onPress={onResume} />
            <Button label={t('record.finish.discard')} variant="destructive" icon="trash-outline" disabled={busy} onPress={onDiscard} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  summary: { gap: spacing.xs },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
