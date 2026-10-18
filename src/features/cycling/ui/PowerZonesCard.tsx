import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { formatDuration } from '@/features/workouts/analysis/types';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Bar, Card, Note, Txt } from '@/features/workouts/analysis/ui/primitives';
import { fmtInt, fmtPercent } from '@/i18n';

import type { PowerZone } from '../types';
import { zoneRangeKind, zoneShares } from './format';

function PowerZonesCardImpl({ zones, ftp }: { zones: readonly PowerZone[]; ftp: number }) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  const shares = zoneShares(zones);
  // Zones 1 to 5 take the analysis ramp, 6 (anaerobic) the cadence purple and 7 (neuromuscular) the muted text colour.
  const colors = [...palette.zones, palette.cadence, palette.textMuted];
  return (
    <Card title={t('section.powerZones')} aside={t('powerZones.ftp', { ftp: fmtInt(ftp) })}>
      {zones.map((zone, i) => {
        const kind = zoneRangeKind(zone);
        const range =
          kind === 'from'
            ? t('powerZones.from', { from: fmtInt(zone.fromW) })
            : kind === 'to'
              ? t('powerZones.to', { to: fmtInt(zone.toW ?? 0) })
              : t('powerZones.range', { from: fmtInt(zone.fromW), to: fmtInt(zone.toW ?? 0) });
        const name = t(`powerZones.name.${zone.key}`);
        const time = formatDuration(zone.sec);
        const share = shares[i] ?? 0;
        return (
          <View
            key={zone.key}
            style={styles.row}
            accessible
            accessibilityLabel={t('powerZones.a11yRow', { n: i + 1, name, range, time, percent: Math.round(share * 100) })}>
            <View style={styles.head}>
              <View style={styles.name}>
                <Txt size={13} bold numberOfLines={1}>
                  {t('powerZones.zone', { n: i + 1, name })}
                </Txt>
                <Txt size={11} muted numberOfLines={1}>
                  {range}
                </Txt>
              </View>
              <View style={styles.value}>
                <Txt size={13} bold align="right">
                  {time}
                </Txt>
                <Txt size={11} muted align="right">
                  {fmtPercent(share * 100)}
                </Txt>
              </View>
            </View>
            <Bar fraction={share} color={colors[i] ?? palette.textMuted} />
          </View>
        );
      })}
      <Note>{t('powerZones.note')}</Note>
    </Card>
  );
}

export const PowerZonesCard = memo(PowerZonesCardImpl);

const styles = StyleSheet.create({
  row: { marginTop: 10, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  name: { flex: 1, minWidth: 0 },
  value: { flexShrink: 0 },
});
