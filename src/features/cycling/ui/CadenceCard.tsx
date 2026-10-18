import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/features/workouts/analysis/types';
import { shares } from '@/features/workouts/analysis/ui/chartMath';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Bar, Card, Note, Txt } from '@/features/workouts/analysis/ui/primitives';
import { fmtInt, fmtPercent } from '@/i18n';

import type { RideCadence } from '../types';
import { barWidth, cadenceBandLabel, pedallingShare } from './format';

function CadenceCardImpl({ cadence }: { cadence: RideCadence }) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const fractions = shares(cadence.bands.map((b) => b.sec));
  const pedalling = pedallingShare(cadence.pedallingSec, cadence.coastingSec);
  return (
    <Card title={t('section.cadence')}>
      {pedalling !== null ? (
        <View>
          <View style={[styles.split, { backgroundColor: palette.surfaceAlt }]}>
            <View style={{ width: barWidth(pedalling), backgroundColor: palette.cadence }} />
          </View>
          <View style={styles.splitLabels}>
            <View style={styles.splitLabel}>
              <Txt size={11} muted>
                {t('cadence.pedalling')}
              </Txt>
              <Txt size={15} bold>
                {fmtPercent(pedalling * 100)}
              </Txt>
              <Txt size={11} muted>
                {formatDuration(cadence.pedallingSec)}
              </Txt>
            </View>
            <View style={styles.splitLabel}>
              <Txt size={11} muted align="right">
                {t('cadence.coasting')}
              </Txt>
              <Txt size={15} bold align="right">
                {fmtPercent((1 - pedalling) * 100)}
              </Txt>
              <Txt size={11} muted align="right">
                {formatDuration(cadence.coastingSec)}
              </Txt>
            </View>
          </View>
        </View>
      ) : null}
      {cadence.bands.map((band, i) => {
        const label = cadenceBandLabel(band);
        const name =
          label.kind === 'coasting'
            ? t('cadence.band.coasting')
            : label.kind === 'open'
              ? t('cadence.band.open', { from: fmtInt(label.from) })
              : t('cadence.band.range', { from: fmtInt(label.from), to: fmtInt(label.to) });
        const share = fractions[i] ?? 0;
        const time = formatDuration(band.sec);
        return (
          <View
            key={band.fromRpm}
            style={styles.row}
            accessible
            accessibilityLabel={t('cadence.a11yRow', { band: name, time, percent: Math.round(share * 100) })}>
            <View style={styles.rowHead}>
              <Txt size={13} bold={label.kind !== 'coasting'} muted={label.kind === 'coasting'}>
                {name}
              </Txt>
              <Txt size={12} muted>
                {t('cadence.timeShare', { time, percent: fmtPercent(share * 100) })}
              </Txt>
            </View>
            <Bar fraction={share} color={label.kind === 'coasting' ? palette.textMuted : palette.cadence} />
          </View>
        );
      })}
      <Note>{t('cadence.note')}</Note>
    </Card>
  );
}

export const CadenceCard = memo(CadenceCardImpl);

const styles = StyleSheet.create({
  split: { height: 12, borderRadius: 6, overflow: 'hidden', flexDirection: 'row' },
  splitLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 },
  splitLabel: { gap: 1 },
  row: { marginTop: 8, gap: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
