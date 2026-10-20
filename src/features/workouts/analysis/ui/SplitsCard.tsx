import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { fmtDecimal } from '@/i18n';

import { isFootKind } from '../sport';
import { stepLengthFromSpeed } from '../stride';
import { formatPace, type AnalysisSplit, type WorkoutAnalysis } from '../types';
import { fastestIndex, paceBarFractions, speedKmhFromPace, splitAtIndex, splitEndIndices, splitLabel } from './chartMath';
import { useAnalysisContext } from './context';
import { Card, MIN_HIT, Txt } from './primitives';
import { useScrubSelector } from './scrub';

const W_KM = 56;
const W_PACE = 44;
const W_ELEV = 56;
const W_HR = 34;
const W_CAD = 36;
const W_STRIDE = 44;
/** The pace bar needs at least this much room (its minimum width plus padding) once every fixed column is placed. */
const MIN_BAR_ROOM = 24 + 16;
/** Horizontal padding of a row (6 on each side). */
const ROW_PAD = 12;

interface Columns {
  elev: boolean;
  hr: boolean;
  cad: boolean;
  stride: boolean;
}

interface RowProps {
  split: AnalysisSplit;
  index: number;
  fraction: number;
  fastest: boolean;
  active: boolean;
  speed: boolean;
  columns: Columns;
  tappable: boolean;
  onSelect: (index: number) => void;
}

const SplitRow = memo(function SplitRow({ split, index, fraction, fastest, active, speed, columns, tappable, onSelect }: RowProps) {
  const { palette, t } = useAnalysisContext();
  const kmh = speedKmhFromPace(split.paceSecKm);
  const valueText = speed ? (kmh !== null ? fmtDecimal(kmh, 1) : '--') : formatPace(split.paceSecKm);
  const label = splitLabel(split);
  const stride = columns.stride ? stepLengthFromSpeed(split.paceSecKm !== null && split.paceSecKm > 0 ? 1000 / split.paceSecKm : null, split.cad) : null;
  const elev =
    split.gainM !== null || split.lossM !== null ? `+${Math.round(split.gainM ?? 0)}/-${Math.round(split.lossM ?? 0)}` : '--';
  const body = (
    <>
      <View style={{ width: W_KM }}>
        <Txt size={13} bold={fastest} numberOfLines={1} fit>
          {label}
        </Txt>
      </View>
      <View style={{ width: W_PACE }}>
        <Txt size={13} bold={fastest} color={fastest ? palette.positive : undefined}>
          {valueText}
        </Txt>
      </View>
      <View style={styles.barCell}>
        <View style={[styles.barTrack, { backgroundColor: palette.surfaceAlt }]}>
          <View
            style={{
              width: `${Math.round(fraction * 100)}%`,
              height: 10,
              borderRadius: 5,
              backgroundColor: fastest ? palette.positive : palette.pace,
            }}
          />
        </View>
      </View>
      {columns.elev ? (
        <View style={{ width: W_ELEV }}>
          <Txt size={11} muted align="right" numberOfLines={1}>
            {elev}
          </Txt>
        </View>
      ) : null}
      {columns.hr ? (
        <View style={{ width: W_HR }}>
          <Txt size={12} align="right">
            {split.hr !== null ? Math.round(split.hr) : '--'}
          </Txt>
        </View>
      ) : null}
      {columns.cad ? (
        <View style={{ width: W_CAD }}>
          <Txt size={12} muted align="right">
            {split.cad !== null ? Math.round(split.cad) : '--'}
          </Txt>
        </View>
      ) : null}
      {columns.stride ? (
        <View style={{ width: W_STRIDE }}>
          <Txt size={12} muted align="right">
            {stride !== null ? fmtDecimal(stride, 2) : '--'}
          </Txt>
        </View>
      ) : null}
    </>
  );
  const style = [styles.row, active ? { backgroundColor: palette.surfaceAlt } : null];
  const a11yLabel = t(speed ? 'splits.a11yRowSpeed' : 'splits.a11yRowPace', { label, value: valueText });
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
      style={style}
    >
      {body}
    </Pressable>
  );
});

function SplitsCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t, store } = useAnalysisContext();
  const { splits, series, sport } = analysis;
  const speed = sport.kind === 'ride';

  const ends = useMemo(() => (series ? splitEndIndices(series, splits) : []), [series, splits]);
  const fractions = useMemo(() => paceBarFractions(splits.map((s) => s.paceSecKm)), [splits]);
  const fastest = useMemo(() => fastestIndex(splits.map((s) => s.paceSecKm)), [splits]);
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (prev === w ? prev : w));
  }, []);
  const columns = useMemo<Columns>(() => {
    const base = {
      elev: splits.some((s) => s.gainM !== null || s.lossM !== null),
      hr: splits.some((s) => s.hr !== null),
      cad: splits.some((s) => s.cad !== null),
    };
    // Step length (from each split's pace and cadence) is the last column and shows only while the bar keeps its room.
    const wantsStride = isFootKind(sport.kind) && splits.some((s) => s.paceSecKm !== null && s.cad !== null);
    const fixed = W_KM + W_PACE + (base.elev ? W_ELEV : 0) + (base.hr ? W_HR : 0) + (base.cad ? W_CAD : 0) + W_STRIDE + ROW_PAD;
    return { ...base, stride: wantsStride && width > 0 && width - fixed >= MIN_BAR_ROOM };
  }, [splits, sport.kind, width]);

  const select = useCallback((i: number) => ends[i] !== undefined && store.set(ends[i]!), [ends, store]);
  const activeSplit = useScrubSelector(
    store,
    useCallback((index: number | null) => splitAtIndex(ends, index), [ends]),
  );

  if (splits.length === 0) return null;
  const tappable = ends.length === splits.length;
  return (
    <Card title={t('section.splits')}>
      <View style={styles.headRow} onLayout={onLayout}>
        <View style={{ width: W_KM }}>
          <Txt size={11} muted>
            {t('splits.km')}
          </Txt>
        </View>
        <View style={{ width: W_PACE }}>
          <Txt size={11} muted>
            {t(speed ? 'splits.speed' : 'splits.pace')}
          </Txt>
        </View>
        <View style={styles.barCell} />
        {columns.elev ? (
          <View style={{ width: W_ELEV }}>
            <Txt size={11} muted align="right">
              {t('splits.elev')}
            </Txt>
          </View>
        ) : null}
        {columns.hr ? (
          <View style={{ width: W_HR }}>
            <Txt size={11} muted align="right">
              {t('splits.hr')}
            </Txt>
          </View>
        ) : null}
        {columns.cad ? (
          <View style={{ width: W_CAD }}>
            <Txt size={11} muted align="right">
              {t('splits.cad')}
            </Txt>
          </View>
        ) : null}
        {columns.stride ? (
          <View style={{ width: W_STRIDE }}>
            <Txt size={11} muted align="right">
              {t('splits.stride')}
            </Txt>
          </View>
        ) : null}
      </View>
      <View style={[styles.rule, { backgroundColor: palette.border }]} />
      {splits.map((split, i) => (
        <SplitRow
          key={split.n}
          split={split}
          index={i}
          fraction={fractions[i] ?? 0}
          fastest={i === fastest}
          active={i === activeSplit}
          speed={speed}
          columns={columns}
          tappable={tappable}
          onSelect={select}
        />
      ))}
    </Card>
  );
}

export const SplitsCard = memo(SplitsCardImpl);

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 6 },
  rule: { height: StyleSheet.hairlineWidth, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_HIT, paddingHorizontal: 6, borderRadius: 8 },
  barCell: { flex: 1, minWidth: 24, paddingHorizontal: 8 },
  barTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
});
