import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Details } from '@/components/Details';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Card, Txt } from '@/features/workouts/analysis/ui/primitives';
import { HrZonesCard } from '@/features/workouts/analysis/ui/ZonesCards';
import { fmtDecimal } from '@/i18n';

import type { RideDecoupling } from '../types';
import { decouplingVerdict } from './format';

function DecouplingCard({ decoupling }: { decoupling: RideDecoupling }) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const verdict = decouplingVerdict(decoupling.pct);
  const value = fmtDecimal(decoupling.pct, 1);
  const color = verdict === 'drift' ? palette.negative : palette.positive;
  return (
    <Card title={t('section.efficiency')}>
      <Txt size={26} bold color={color}>
        {decoupling.basis === 'power' ? t('hr.pwhr', { value }) : t('hr.pahr', { value })}
      </Txt>
      <Txt size={13} style={styles.line}>
        {t(`hr.${verdict}`)}
      </Txt>
      <Txt size={12} muted style={styles.line}>
        {t('hr.halves', { first: fmtDecimal(decoupling.firstEf, 2), second: fmtDecimal(decoupling.secondEf, 2) })}
      </Txt>
      <View style={styles.line}>
        <Details title={t('hr.how')}>{t(decoupling.basis === 'power' ? 'hr.explainPower' : 'hr.explainSpeed')}</Details>
      </View>
    </Card>
  );
}

/** Time in heart rate zones (the generic card) and, for a long enough ride, how far the heart rate drifted for the same effort. */
function HrCardImpl({ analysis, decoupling }: { analysis: WorkoutAnalysis; decoupling: RideDecoupling | null }) {
  return (
    <>
      <HrZonesCard analysis={analysis} />
      {decoupling ? <DecouplingCard decoupling={decoupling} /> : null}
    </>
  );
}

export const HrCard = memo(HrCardImpl);

const styles = StyleSheet.create({
  line: { marginTop: 8 },
});
