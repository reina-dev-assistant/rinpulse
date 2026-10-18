import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDuration, type WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { splitAtIndex } from '@/features/workouts/analysis/ui/chartMath';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Card, MIN_HIT, Note, Txt } from '@/features/workouts/analysis/ui/primitives';
import { useScrubSelector } from '@/features/workouts/analysis/ui/scrub';
import { fmtDecimal, fmtDistance, fmtInt } from '@/i18n';

import type { RideLap, RideSplit } from '../types';
import { barWidth, fastestSpeedIndex, speedBarFractions, splitEndKm, splitEnds } from './format';

const W_KM = 44;
const W_SPEED = 44;
const W_GAIN = 40;
const W_HR = 34;
const W_POWER = 42;
const W_CAD = 34;

interface Columns {
  gain: boolean;
  hr: boolean;
  power: boolean;
  cad: boolean;
}

interface RowProps {
  split: RideSplit;
  index: number;
  km: number;
  fraction: number;
  fastest: boolean;
  active: boolean;
  columns: Columns;
  tappable: boolean;
  onSelect: (index: number) => void;
}

const SplitRow = memo(function SplitRow({ split, index, km, fraction, fastest, active, columns, tappable, onSelect }: RowProps) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const speedText = split.avgSpeedKmh !== null ? fmtDecimal(split.avgSpeedKmh, 1) : '--';
  const label = Math.abs(km - Math.round(km)) < 0.05 ? fmtInt(Math.round(km)) : fmtDecimal(km, 1);
  const body = (
    <>
      <View style={{ width: W_KM }}>
        <Txt size={13} bold={fastest} numberOfLines={1} fit>
          {label}
        </Txt>
      </View>
      <View style={{ width: W_SPEED }}>
        <Txt size={13} bold={fastest} color={fastest ? palette.positive : undefined}>
          {speedText}
        </Txt>
      </View>
      <View style={styles.barCell}>
        <View style={[styles.barTrack, { backgroundColor: palette.surfaceAlt }]}>
          <View style={{ width: barWidth(fraction), height: 10, borderRadius: 5, backgroundColor: fastest ? palette.positive : palette.pace }} />
        </View>
      </View>
      {columns.gain ? (
        <View style={{ width: W_GAIN }}>
          <Txt size={11} muted align="right" numberOfLines={1}>
            {split.gainM !== null ? `+${fmtInt(split.gainM)}` : '--'}
          </Txt>
        </View>
      ) : null}
      {columns.hr ? (
        <View style={{ width: W_HR }}>
          <Txt size={12} align="right">
            {split.avgHr !== null ? fmtInt(split.avgHr) : '--'}
          </Txt>
        </View>
      ) : null}
      {columns.power ? (
        <View style={{ width: W_POWER }}>
          <Txt size={12} align="right">
            {split.avgPower !== null ? fmtInt(split.avgPower) : '--'}
          </Txt>
        </View>
      ) : null}
      {columns.cad ? (
        <View style={{ width: W_CAD }}>
          <Txt size={12} muted align="right">
            {split.avgCad !== null ? fmtInt(split.avgCad) : '--'}
          </Txt>
        </View>
      ) : null}
    </>
  );
  const style = [styles.row, active ? { backgroundColor: palette.surfaceAlt } : null];
  const a11yLabel = t('splits.a11yRow', { km: label, speed: speedText });
  if (!tappable) {
    return (
      <View style={style} accessible accessibilityLabel={a11yLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onSelect(index)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={t('splits.a11yHint')}
      accessibilityState={{ selected: active }}
      style={style}>
      {body}
    </Pressable>
  );
});

function HeadCell({ width, label, align = 'right' }: { width: number; label: string; align?: 'left' | 'right' }) {
  return (
    <View style={{ width }}>
      <Txt size={11} muted align={align}>
        {label}
      </Txt>
    </View>
  );
}

function RideSplitsCardImpl({ analysis, splits, laps }: { analysis: WorkoutAnalysis; splits: readonly RideSplit[]; laps: readonly RideLap[] }) {
  const { palette, store } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const dist = analysis.series?.dist ?? null;

  const ends = useMemo(() => splitEnds(dist, splits), [dist, splits]);
  const kms = useMemo(() => splitEndKm(splits), [splits]);
  const speeds = useMemo(() => splits.map((s) => s.avgSpeedKmh), [splits]);
  const fractions = useMemo(() => speedBarFractions(speeds), [speeds]);
  const fastest = useMemo(() => fastestSpeedIndex(speeds), [speeds]);
  const columns = useMemo<Columns>(
    () => ({
      gain: splits.some((s) => s.gainM !== null),
      hr: splits.some((s) => s.avgHr !== null),
      power: splits.some((s) => s.avgPower !== null),
      cad: splits.some((s) => s.avgCad !== null),
    }),
    [splits],
  );

  const select = useCallback((i: number) => ends[i] !== undefined && store.set(ends[i]!), [ends, store]);
  const activeSplit = useScrubSelector(
    store,
    useCallback((index: number | null) => splitAtIndex(ends, index), [ends]),
  );

  if (splits.length === 0 && laps.length === 0) return null;
  const tappable = ends.length === splits.length;
  return (
    <>
      {splits.length > 0 ? (
        <Card title={t('section.splits')}>
          <View style={styles.headRow}>
            <HeadCell width={W_KM} label={t('splits.km')} align="left" />
            <HeadCell width={W_SPEED} label={t('splits.speed')} align="left" />
            <View style={styles.barCell} />
            {columns.gain ? <HeadCell width={W_GAIN} label={t('splits.gain')} /> : null}
            {columns.hr ? <HeadCell width={W_HR} label={t('splits.hr')} /> : null}
            {columns.power ? <HeadCell width={W_POWER} label={t('splits.power')} /> : null}
            {columns.cad ? <HeadCell width={W_CAD} label={t('splits.cad')} /> : null}
          </View>
          <View style={[styles.rule, { backgroundColor: palette.border }]} />
          {splits.map((split, i) => (
            <SplitRow
              key={split.n}
              split={split}
              index={i}
              km={kms[i] ?? 0}
              fraction={fractions[i] ?? 0}
              fastest={i === fastest}
              active={i === activeSplit}
              columns={columns}
              tappable={tappable}
              onSelect={select}
            />
          ))}
          <Note>{t('splits.note')}</Note>
        </Card>
      ) : null}
      {laps.length > 0 ? <LapsTable laps={laps} /> : null}
    </>
  );
}

const FLEX = { lap: 0.6, time: 1.1, dist: 1.2, speed: 0.9, hr: 0.8, power: 0.9, cad: 0.8 };

function LapsTable({ laps }: { laps: readonly RideLap[] }) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const show = {
    dist: laps.some((l) => l.distM > 0),
    speed: laps.some((l) => l.avgSpeedKmh !== null),
    hr: laps.some((l) => l.avgHr !== null),
    power: laps.some((l) => l.avgPower !== null),
    cad: laps.some((l) => l.avgCad !== null),
  };
  const cell = (flex: number, text: string, opts: { head?: boolean; align?: 'left' | 'right'; bold?: boolean } = {}) => (
    <View style={{ flex, minWidth: 0 }}>
      <Txt size={opts.head ? 11 : 12} muted={opts.head} bold={opts.bold} align={opts.align ?? 'right'} numberOfLines={1} fit={!opts.head}>
        {text}
      </Txt>
    </View>
  );
  return (
    <Card title={t('section.laps')}>
      <View style={styles.lapRow}>
        {cell(FLEX.lap, t('laps.lap'), { head: true, align: 'left' })}
        {cell(FLEX.time, t('laps.time'), { head: true })}
        {show.dist ? cell(FLEX.dist, t('laps.dist'), { head: true }) : null}
        {show.speed ? cell(FLEX.speed, t('laps.speed'), { head: true }) : null}
        {show.hr ? cell(FLEX.hr, t('laps.hr'), { head: true }) : null}
        {show.power ? cell(FLEX.power, t('laps.power'), { head: true }) : null}
        {show.cad ? cell(FLEX.cad, t('laps.cad'), { head: true }) : null}
      </View>
      <View style={[styles.rule, { backgroundColor: palette.border }]} />
      {laps.map((lap) => {
        const speed = lap.avgSpeedKmh;
        return (
          <View key={lap.n} style={styles.lapRow} accessible accessibilityLabel={t('laps.a11yRow', { n: lap.n, time: formatDuration(lap.sec) })}>
            {cell(FLEX.lap, fmtInt(lap.n), { align: 'left', bold: true })}
            {cell(FLEX.time, formatDuration(lap.sec))}
            {show.dist ? cell(FLEX.dist, lap.distM > 0 ? fmtDistance(lap.distM) : '--') : null}
            {show.speed ? cell(FLEX.speed, speed !== null ? fmtDecimal(speed, 1) : '--') : null}
            {show.hr ? cell(FLEX.hr, lap.avgHr !== null ? fmtInt(lap.avgHr) : '--') : null}
            {show.power ? cell(FLEX.power, lap.avgPower !== null ? fmtInt(lap.avgPower) : '--') : null}
            {show.cad ? cell(FLEX.cad, lap.avgCad !== null ? fmtInt(lap.avgCad) : '--') : null}
          </View>
        );
      })}
    </Card>
  );
}

export const RideSplitsCard = memo(RideSplitsCardImpl);

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 6 },
  rule: { height: StyleSheet.hairlineWidth, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_HIT, paddingHorizontal: 6, borderRadius: 8 },
  lapRow: { flexDirection: 'row', alignItems: 'center', minHeight: 32, gap: 4 },
  barCell: { flex: 1, minWidth: 16, paddingHorizontal: 6 },
  barTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
});
