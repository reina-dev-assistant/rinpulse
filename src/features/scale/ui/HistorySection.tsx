import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Divider, Section } from '@/components/Screen';
import { fmtDateTime, fmtDecimal } from '@/i18n/format';
import { IMPORTED_SCALE_ID, type WeighIn } from '@/features/scale/store';
import { spacing } from '@/theme';

import { bodyValues, type BodyValue } from './format';

/** Weigh-ins drawn at first and added by each tap of the "show more" button. */
export const HISTORY_PAGE = 40;

interface HistorySectionProps {
  weighIns: readonly WeighIn[];
  rogoWaiting: number;
  needsProfile: boolean;
  onRetry: () => void;
  onDelete: (id: number) => void;
}

function BodyLine({ values, label }: { values: BodyValue[]; label: string }) {
  const { t } = useTranslation('scale');
  if (values.length === 0) return null;
  return (
    <AppText variant="caption" muted>
      {`${label}: ${values.map((v) => t(`body.${v.key}`, { value: fmtDecimal(v.value, v.key === 'visceral' || v.key === 'bmr' ? 0 : 1) })).join(', ')}`}
    </AppText>
  );
}

/** The local weigh-in history, with what JoyoRogo has of it. Body values from the scale and formula estimates are labelled apart. */
export function HistorySection({ weighIns, rogoWaiting, needsProfile, onRetry, onDelete }: HistorySectionProps) {
  const { t } = useTranslation('scale');
  const [shown, setShown] = useState(HISTORY_PAGE);
  const anyImpedance = weighIns.some((w) => w.impedanceOhm !== null && w.reported === null);
  const visible = weighIns.slice(0, shown);
  return (
    <Section title={t('history.title')} icon="time-outline">
      {rogoWaiting > 0 ? (
        <View style={styles.waiting}>
          <AppText variant="caption" muted style={styles.waitingText}>
            {t('history.waiting', { count: rogoWaiting })}
          </AppText>
          <Button label={t('history.retry')} onPress={onRetry} />
        </View>
      ) : null}
      {weighIns.length === 0 ? (
        <AppText variant="caption" muted>
          {t('history.empty')}
        </AppText>
      ) : (
        visible.map((w, index) => (
          <View key={w.id}>
            {index > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <View style={styles.text}>
                <AppText variant="bodyStrong">{t('live.weight', { value: fmtDecimal(w.weightKg, 1) })}</AppText>
                <AppText variant="caption" muted>
                  {[fmtDateTime(new Date(w.takenAt)), w.scaleId === IMPORTED_SCALE_ID ? t('history.imported') : null, t(`history.${w.rogoState}`)]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
                <BodyLine values={bodyValues(w.reported)} label={t('body.measured')} />
                <BodyLine values={bodyValues(w.estimate)} label={t('body.estimate')} />
              </View>
              <Button label={t('history.delete')} variant="ghost" onPress={() => onDelete(w.id)} />
            </View>
          </View>
        ))
      )}
      {weighIns.length > shown ? (
        <Button label={t('history.more', { count: weighIns.length - shown })} variant="secondary" onPress={() => setShown((n) => n + HISTORY_PAGE)} />
      ) : null}
      {needsProfile && anyImpedance ? (
        <AppText variant="caption" muted>
          {t('body.needProfile')}
        </AppText>
      ) : null}
      {weighIns.some((w) => w.estimate !== null) ? <Details>{t('body.estimateNote')}</Details> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  waitingText: { flex: 1 },
});
