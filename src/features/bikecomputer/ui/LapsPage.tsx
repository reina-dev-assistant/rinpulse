import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatElapsed, workoutDistanceParts } from '@/features/workouts/summary';
import { fmtInt } from '@/i18n';
import { useTheme } from '@/theme';

import type { FieldValue } from '../types';
import { FieldCell } from './FieldCell';
import type { RidePalette } from './ridePalette';

export interface LapRowData {
  number: number;
  distanceM: number;
  movingSec: number;
  avgHr: number | null;
}

interface LapsPageProps {
  /** Finished laps, oldest first. */
  laps: readonly LapRowData[];
  /** The running lap: its number and the two figures, from the data fields. */
  current: { number: number; time: FieldValue; distance: FieldValue } | null;
  width: number;
  palette: RidePalette;
}

/** The laps page: the running lap as two big numbers, then the finished laps, newest first. */
export function LapsPage({ laps, current, width, palette }: LapsPageProps) {
  const { t } = useTranslation('bikecomp');
  const { fonts } = useTheme();
  const rows = laps.slice().reverse();
  const half = width / 2;

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      {current ? (
        <View style={[styles.current, { borderBottomColor: palette.hairline }]}>
          <Text style={[styles.heading, { color: palette.foreground, fontFamily: fonts.heavy }]}>{t('page.laps.current', { number: current.number })}</Text>
          <View style={styles.pair}>
            <FieldCell name={t('field.lapTime.name')} label={t('field.lapTime.name')} shortLabel={t('field.lapTime.short')} value={current.time} width={half} height={130} palette={palette} />
            <FieldCell name={t('field.lapDistance.name')} label={t('field.lapDistance.name')} shortLabel={t('field.lapDistance.short')} value={current.distance} width={half} height={130} palette={palette} />
          </View>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.muted, fontFamily: fonts.bold }]}>{t('page.laps.empty')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          <Text style={[styles.header, { color: palette.muted, fontFamily: fonts.bold }]}>{t('page.laps.finishedHeader')}</Text>
          {rows.map((row) => {
            const distance = workoutDistanceParts(row.distanceM);
            const stats = `${distance.value} ${distance.unit}`;
            const time = formatElapsed(row.movingSec);
            return (
              <View
                key={row.number}
                accessible
                accessibilityLabel={`${t('page.laps.row', { number: row.number })}: ${
                  row.avgHr === null
                    ? t('page.laps.stats', { distance: stats, time })
                    : t('page.laps.statsHr', { distance: stats, time, hr: fmtInt(row.avgHr) })
                }`}
                style={[styles.row, { borderBottomColor: palette.hairline }]}>
                <Text style={[styles.rowName, { color: palette.muted, fontFamily: fonts.bold }]}>{t('page.laps.row', { number: row.number })}</Text>
                <Text style={[styles.rowTime, { color: palette.foreground, fontFamily: fonts.numeral }]}>{time}</Text>
                <Text style={[styles.rowDistance, { color: palette.foreground, fontFamily: fonts.bold }]}>{stats}</Text>
                {row.avgHr !== null ? <Text style={[styles.rowHr, { color: palette.muted, fontFamily: fonts.bold }]}>{fmtInt(row.avgHr)}</Text> : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  current: { borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { fontSize: 22, lineHeight: 28, paddingHorizontal: 16, paddingTop: 12 },
  pair: { flexDirection: 'row' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyText: { fontSize: 20, lineHeight: 28, textAlign: 'center' },
  list: { paddingBottom: 12 },
  header: { fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowName: { width: 64, fontSize: 16 },
  rowTime: { fontSize: 28, fontVariant: ['tabular-nums'] },
  rowDistance: { flex: 1, fontSize: 18, textAlign: 'right', fontVariant: ['tabular-nums'] },
  rowHr: { fontSize: 16, minWidth: 36, textAlign: 'right' },
});
