import { useRouter } from 'expo-router';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Notice } from '@/components/States';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Card, Txt } from '@/features/workouts/analysis/ui/primitives';
import { fmtDecimal, fmtInt } from '@/i18n';

import type { RidePower } from '../types';
import { balanceSplit, barWidth } from './format';
import { StatGrid, type Cell } from './StatGrid';

function BalanceBar({ leftPct }: { leftPct: number }) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const { left, right } = balanceSplit(leftPct);
  const values = { left, right };
  return (
    <View style={styles.balance} accessible accessibilityRole="image" accessibilityLabel={t('power.balanceA11y', values)}>
      <View style={styles.balanceHead}>
        <Txt size={11} muted>
          {t('power.balance')}
        </Txt>
        <Txt size={13} bold>
          {t('power.balanceValue', values)}
        </Txt>
      </View>
      <View style={[styles.balanceTrack, { backgroundColor: palette.surfaceAlt }]}>
        <View style={{ width: barWidth(left / 100), backgroundColor: palette.power }} />
        <View style={{ flex: 1, backgroundColor: palette.cadence }} />
      </View>
    </View>
  );
}

function PowerCardImpl({ power }: { power: RidePower }) {
  const { t } = useTranslation('cycling');
  const router = useRouter();
  const cells: Cell[] = [
    { key: 'avg', label: t('power.avg'), value: fmtInt(power.avg), unit: t('unit.w') },
    { key: 'np', label: t('power.np'), value: power.normalized !== null ? fmtInt(power.normalized) : '--', unit: t('unit.w') },
    { key: 'max', label: t('power.max'), value: fmtInt(power.max), unit: t('unit.w') },
  ];
  if (power.intensityFactor !== null) cells.push({ key: 'if', label: t('power.if'), value: fmtDecimal(power.intensityFactor, 2) });
  if (power.tss !== null) cells.push({ key: 'tss', label: t('power.tss'), value: fmtInt(power.tss) });
  if (power.variabilityIndex !== null) cells.push({ key: 'vi', label: t('power.vi'), value: fmtDecimal(power.variabilityIndex, 2) });
  cells.push({ key: 'work', label: t('power.work'), value: fmtInt(power.workKj), unit: t('unit.kj') });
  if (power.avgWkg !== null) {
    cells.push({
      key: 'wkg',
      label: t('power.wkg'),
      value: fmtDecimal(power.avgWkg, 2),
      sub: power.normalizedWkg !== null ? t('summary.wkgNp', { value: fmtDecimal(power.normalizedWkg, 2) }) : undefined,
    });
  }
  if (power.ftp !== null) cells.push({ key: 'ftp', label: t('power.ftp'), value: fmtInt(power.ftp), unit: t('unit.w') });

  return (
    <Card title={t('section.power')}>
      <StatGrid cells={cells} columns={3} />
      {power.balanceLeftPct !== null ? <BalanceBar leftPct={power.balanceLeftPct} /> : null}
      {power.ftp === null ? (
        <View style={styles.block}>
          <Notice icon="flash-outline" action={{ label: t('power.setFtp'), onPress: () => router.push('/settings/cycling') }}>
            {t('power.noFtp')}
          </Notice>
        </View>
      ) : null}
      <View style={styles.block}>
        <Details title={t('power.how')}>
          <View style={styles.explain}>
            <Txt size={12} muted>
              {t('power.explain')}
            </Txt>
            {power.avgWkg !== null ? (
              <Button label={t('power.profileLink')} variant="ghost" icon="person-outline" onPress={() => router.push('/settings/profile')} />
            ) : null}
          </View>
        </Details>
      </View>
    </Card>
  );
}

export const PowerCard = memo(PowerCardImpl);

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  explain: { gap: 6 },
  balance: { marginTop: 14, gap: 6 },
  balanceHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  balanceTrack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
});
