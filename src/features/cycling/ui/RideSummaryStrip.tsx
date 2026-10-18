import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Details } from '@/components/Details';
import { Notice } from '@/components/States';
import { formatDuration } from '@/features/workouts/analysis/types';
import { distanceParts, kcalPerHour } from '@/features/workouts/analysis/ui/chartMath';
import { Card, Divider, Txt } from '@/features/workouts/analysis/ui/primitives';
import { fmtDecimal, fmtInt } from '@/i18n';

import type { RideAnalysis } from '../types';
import { kmhOf } from './format';
import { StatCell, StatGrid, type Cell } from './StatGrid';

function RideSummaryStripImpl({ ride }: { ride: RideAnalysis }) {
  const { t } = useTranslation('cycling');
  const { times, speed, elevation, calories, hr, cadence, power, distanceM } = ride;
  const kmh = t('unit.kmh');

  const hero: Cell[] = [];
  if (distanceM !== null && distanceM > 0) {
    const d = distanceParts(distanceM);
    hero.push({ key: 'distance', label: t('summary.distance'), value: d.value, unit: d.unit === 'km' ? t('unit.km') : t('unit.m') });
  }
  const stopped = times.elapsedSec > times.movingSec;
  hero.push({
    key: 'time',
    label: stopped ? t('summary.movingTime') : t('summary.time'),
    value: formatDuration(stopped ? times.movingSec : times.elapsedSec),
    sub: stopped
      ? times.stoppedSec >= 1
        ? t('summary.elapsedStopped', { elapsed: formatDuration(times.elapsedSec), stopped: formatDuration(times.stoppedSec) })
        : t('summary.elapsed', { time: formatDuration(times.elapsedSec) })
      : undefined,
  });
  const moving = kmhOf(speed.avgMovingMs);
  if (moving !== null && moving > 0) {
    hero.push({ key: 'moving', label: t('summary.avgMovingSpeed'), value: fmtDecimal(moving, 1), unit: kmh });
  }

  const grid: Cell[] = [];
  const timer = kmhOf(speed.avgMs);
  if (timer !== null && timer > 0) {
    const overall = kmhOf(speed.avgOverallMs);
    grid.push({
      key: 'avgSpeed',
      label: t('summary.avgSpeed'),
      value: fmtDecimal(timer, 1),
      unit: kmh,
      sub: overall !== null ? t('summary.overall', { value: fmtDecimal(overall, 1) }) : undefined,
    });
  }
  const top = kmhOf(speed.maxMs);
  if (top !== null && top > 0) grid.push({ key: 'maxSpeed', label: t('summary.maxSpeed'), value: fmtDecimal(top, 1), unit: kmh });
  if (!ride.indoor && elevation) {
    grid.push({
      key: 'elevation',
      label: t('summary.elevation'),
      value: t('value.gainLoss', { gain: fmtInt(elevation.gainM), loss: fmtInt(elevation.lossM) }),
      unit: t('unit.m'),
    });
    if (elevation.avgGradePct !== null) {
      grid.push({
        key: 'grade',
        label: t('summary.grade'),
        value: t('value.percent', { value: fmtDecimal(elevation.avgGradePct, 1) }),
        sub: elevation.maxGradePct !== null ? t('summary.maxGrade', { value: fmtDecimal(elevation.maxGradePct, 1) }) : undefined,
      });
    }
  }
  if (calories) {
    const perHour = kcalPerHour(calories.kcal, times.elapsedSec);
    grid.push({
      key: 'calories',
      label: t('summary.calories'),
      value: fmtInt(calories.kcal),
      unit: t('unit.kcal'),
      sub: perHour !== null ? t('summary.caloriesPerHour', { value: fmtInt(perHour) }) : undefined,
    });
  }
  if (hr.avg !== null) {
    grid.push({
      key: 'hr',
      label: t('summary.heartRate'),
      value: fmtInt(hr.avg),
      unit: t('unit.bpm'),
      sub: hr.max !== null ? t('summary.maxHr', { value: fmtInt(hr.max) }) : undefined,
    });
  }
  if (cadence?.avg != null) {
    grid.push({
      key: 'cad',
      label: t('summary.cadence'),
      value: fmtInt(cadence.avg),
      unit: t('unit.rpm'),
      sub: cadence.max !== null ? t('summary.maxCadence', { value: fmtInt(cadence.max) }) : undefined,
    });
  }
  if (power) {
    grid.push({
      key: 'power',
      label: t('summary.power'),
      value: fmtInt(power.avg),
      unit: t('unit.w'),
      sub: power.normalized !== null ? t('summary.normalizedPower', { value: fmtInt(power.normalized) }) : undefined,
    });
    grid.push({ key: 'maxPower', label: t('summary.maxPower'), value: fmtInt(power.max), unit: t('unit.w') });
    if (power.avgWkg !== null) {
      grid.push({
        key: 'wkg',
        label: t('summary.wkg'),
        value: fmtDecimal(power.avgWkg, 2),
        unit: t('unit.wkg'),
        sub: power.normalizedWkg !== null ? t('summary.wkgNp', { value: fmtDecimal(power.normalizedWkg, 2) }) : undefined,
      });
    }
  }

  return (
    <Card a11yLabel={t('summary.a11y')}>
      <View style={styles.heroRow}>
        {hero.map((cell) => (
          <StatCell key={cell.key} cell={cell} big />
        ))}
      </View>
      {grid.length > 0 ? (
        <>
          <Divider />
          <StatGrid cells={grid} />
        </>
      ) : null}
      {calories ? (
        <Txt size={12} muted style={styles.note}>
          {t(`summary.calorieSource.${calories.source}`)}
        </Txt>
      ) : null}
      {speed.source === 'power' ? (
        <View style={styles.note}>
          <Notice icon="speedometer-outline">{t('speedEstimate')}</Notice>
        </View>
      ) : null}
      <View style={styles.note}>
        <Details title={t('summary.how')}>
          <View style={styles.explain}>
            <Txt size={12} muted>
              {t('summary.explain')}
            </Txt>
            <Txt size={12} muted>
              {t(`summary.speedSource.${speed.source}`)}
            </Txt>
          </View>
        </Details>
      </View>
    </Card>
  );
}

export const RideSummaryStrip = memo(RideSummaryStripImpl);

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', gap: 12 },
  note: { marginTop: 12 },
  explain: { gap: 6 },
});
