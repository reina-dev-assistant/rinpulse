import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Details } from '@/components/Details';
import { hrZoneName } from '@/features/hrzones/names';
import { fmtPercent } from '@/i18n';

import { formatDuration, formatPace, type PaceZoneKey, type WorkoutAnalysis } from '../types';
import { shares } from './chartMath';
import { useAnalysisContext } from './context';
import { Bar, Card, Note, Txt } from './primitives';
import type { AnalysisTextKey } from './text';
import { hrZoneColor } from './theme';

const ZONE_NAME: Record<PaceZoneKey, AnalysisTextKey> = {
  recovery: 'zone.recovery',
  endurance: 'zone.endurance',
  tempo: 'zone.tempo',
  threshold: 'zone.threshold',
  vo2: 'zone.vo2',
};

interface ZoneRowProps {
  n: number;
  name: string;
  range: string;
  sec: number;
  share: number;
  color: string;
}

function ZoneRow({ n, name, range, sec, share, color }: ZoneRowProps) {
  const { t } = useAnalysisContext();
  const time = formatDuration(sec);
  const percent = Math.round(share * 100);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={t('zones.a11yRow', { n, name, range, time, percent })}
    >
      <View style={styles.rowHead}>
        <View style={styles.rowName}>
          <Txt size={13} bold numberOfLines={1}>
            {t('zones.zoneLabel', { n, name })}
          </Txt>
          <Txt size={11} muted numberOfLines={1}>
            {range}
          </Txt>
        </View>
        <View style={styles.rowValue}>
          <Txt size={13} bold align="right">
            {time}
          </Txt>
          <Txt size={11} muted align="right">
            {fmtPercent(share * 100)}
          </Txt>
        </View>
      </View>
      <Bar fraction={share} color={color} />
    </View>
  );
}

function HrZonesCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const zones = analysis.hrZones;
  if (!zones) return null;
  const fractions = shares(zones.sec);
  return (
    <Card title={t('section.hrZones')}>
      <Txt size={12} muted style={styles.lead}>
        {t(zones.source === 'age' ? 'zones.maxHrAge' : 'zones.maxHrSetting', { value: zones.maxHr })}
      </Txt>
      {zones.sec.map((_, i) => (
        <ZoneRow
          key={i}
          n={i + 1}
          name={hrZoneName(zones.method ?? 'max', i + 1)}
          range={t('zones.hrRange', { from: zones.bounds[i]!, to: zones.bounds[i + 1]! })}
          sec={zones.sec[i] ?? 0}
          share={fractions[i] ?? 0}
          color={hrZoneColor(palette, i + 1)}
        />
      ))}
      {zones.belowSec > 0 ? (
        <Txt size={12} muted style={styles.below}>
          {t('zones.below', { time: formatDuration(zones.belowSec) })}
        </Txt>
      ) : null}
      <Details>{t('zones.hrNote')}</Details>
    </Card>
  );
}

function PaceZonesCardImpl({ analysis }: { analysis: WorkoutAnalysis }) {
  const { palette, t } = useAnalysisContext();
  const zones = analysis.paceZones;
  if (!zones) return null;
  const fractions = shares(zones.zones.map((z) => z.sec));
  return (
    <Card title={t('section.paceZones')}>
      <Txt size={12} muted style={styles.lead}>
        {t('zones.thresholdPace', { pace: formatPace(zones.thresholdSecKm) })}
      </Txt>
      {zones.zones.map((z, i) => {
        const range =
          z.fromSecKm === null
            ? t('zones.slowerThan', { pace: formatPace(z.toSecKm) })
            : z.toSecKm === null
              ? t('zones.fasterThan', { pace: formatPace(z.fromSecKm) })
              : t('zones.paceRange', { from: formatPace(z.fromSecKm), to: formatPace(z.toSecKm) });
        return (
          <ZoneRow
            key={z.key}
            n={i + 1}
            name={t(ZONE_NAME[z.key])}
            range={range}
            sec={z.sec}
            share={fractions[i] ?? 0}
            color={palette.zones[i]!}
          />
        );
      })}
      <Note>{t('note.threshold')}</Note>
    </Card>
  );
}

export const HrZonesCard = memo(HrZonesCardImpl);
export const PaceZonesCard = memo(PaceZonesCardImpl);

const styles = StyleSheet.create({
  lead: { marginBottom: 10 },
  row: { marginBottom: 12, gap: 6 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  rowName: { flex: 1, minWidth: 0 },
  rowValue: { flexShrink: 0 },
  below: { marginBottom: 2 },
});
