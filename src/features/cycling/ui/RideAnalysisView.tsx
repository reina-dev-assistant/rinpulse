import { memo, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { ChartsCard } from '@/features/workouts/analysis/ui/ChartsCard';
import { AnalysisContext, type AnalysisContextValue } from '@/features/workouts/analysis/ui/context';
import { EffortCard } from '@/features/workouts/analysis/ui/EffortLoadCards';
import { MapSection } from '@/features/workouts/analysis/ui/MapSection';
import { Card, Txt } from '@/features/workouts/analysis/ui/primitives';
import { createScrubStore } from '@/features/workouts/analysis/ui/scrub';
import type { AnalysisT } from '@/features/workouts/analysis/ui/text';
import type { AnalysisMapTheme, AnalysisPalette } from '@/features/workouts/analysis/ui/theme';

import type { AllTimeBest } from '../store';
import type { RideAnalysis } from '../types';
import { CadenceCard } from './CadenceCard';
import { ClimbsCard } from './ClimbsCard';
import { FtpSuggestionCard } from './FtpSuggestionCard';
import { HrCard } from './HrCard';
import { PowerCard } from './PowerCard';
import { PowerCurveCard } from './PowerCurveCard';
import { PowerZonesCard } from './PowerZonesCard';
import { RideLoadCard } from './RideLoadCard';
import { RideSplitsCard } from './RideSplitsCard';
import { RideSummaryStrip } from './RideSummaryStrip';

const ignoreScrub = () => {};

export interface RideAnalysisViewProps {
  /** The generic analysis (from `analyzeWorkout`): the charts, the map, the heart rate zones and the 7 and 28 day load come from it. */
  analysis: WorkoutAnalysis;
  ride: RideAnalysis;
  /** Memoize `palette` and `t`: a new identity re-renders every card. */
  palette: AnalysisPalette;
  t: AnalysisT;
  mapTheme: AnalysisMapTheme;
  /** True while a chart or map gesture owns the touch; lock the parent ScrollView's scrolling. Keep the function's identity stable (a state setter). */
  onScrubActive?: (active: boolean) => void;
  /** The FTP in use (Settings > Bersepeda), watts; null when none. */
  ftp: number | null;
  /** Body weight for the W/kg of the key efforts; null hides them. */
  weightKg?: number | null;
  /** The best power of each duration over the stored rides. */
  allTime: readonly AllTimeBest[];
  /** Key durations (seconds) this ride holds the all-time best for. */
  records: readonly number[];
  /** Tapped Use on the FTP estimate. The FTP is never changed without it. */
  onUseFtp?: (watts: number) => void;
}

/**
 * The ride detail as a stack of cards (12 px apart); the parent screen provides the scroll view. Like `WorkoutAnalysisView` one scrub
 * index ties the charts, the map, the splits and the climbs together. Cards without data are left out; an indoor ride has no map,
 * elevation or climbs.
 */
function RideAnalysisViewImpl({ analysis, ride, palette, t, mapTheme, onScrubActive, ftp, weightKg = null, allTime, records, onUseFtp }: RideAnalysisViewProps) {
  const [store] = useState(createScrubStore);
  const setScrubActive = onScrubActive ?? ignoreScrub;
  const value = useMemo<AnalysisContextValue>(() => ({ palette, t, store, setScrubActive }), [palette, t, store, setScrubActive]);

  // An indoor trainer has no road: the altitude and track the recorder wrote (often zeros or none) are not shown.
  const view = useMemo<WorkoutAnalysis>(() => {
    if (!ride.indoor || !analysis.series) return analysis;
    return { ...analysis, elevation: null, series: { ...analysis.series, alt: null, track: null } };
  }, [analysis, ride.indoor]);

  const series = view.series;
  const hasSeries = series !== null && series.n >= 2;
  const hasTrack = hasSeries && !ride.indoor && series.track !== null && series.track.some((p) => p !== null);
  const power = ride.power;
  const ftpUsed = power?.ftp ?? null;
  const hasCadence = ride.cadence !== null && ride.cadence.bands.some((b) => b.sec > 0);

  return (
    <AnalysisContext.Provider value={value}>
      <View style={styles.stack}>
        <RideSummaryStrip ride={ride} />
        {hasTrack ? <MapSection analysis={view} mapTheme={mapTheme} /> : null}
        {hasSeries ? <ChartsCard analysis={view} /> : null}
        {!hasSeries ? (
          <Card>
            <Txt size={13} muted>
              {t('empty.noSeries')}
            </Txt>
          </Card>
        ) : null}
        <RideSplitsCard analysis={view} splits={ride.splits} laps={ride.laps} />
        {!ride.indoor && ride.climbs.length > 0 ? <ClimbsCard analysis={view} climbs={ride.climbs} /> : null}
        {power ? <PowerCard power={power} /> : null}
        {power?.zones && ftpUsed !== null ? <PowerZonesCard zones={power.zones} ftp={ftpUsed} /> : null}
        {power && power.curve.length > 0 ? <PowerCurveCard curve={power.curve} allTime={allTime} records={records} weightKg={weightKg} /> : null}
        {ride.ftpSuggestion ? <FtpSuggestionCard suggestion={ride.ftpSuggestion} ftp={ftp} onUse={onUseFtp} /> : null}
        {hasCadence && ride.cadence ? <CadenceCard cadence={ride.cadence} /> : null}
        <HrCard analysis={view} decoupling={ride.hr.decoupling} />
        <EffortCard analysis={view} />
        <RideLoadCard analysis={view} load={ride.load} />
      </View>
    </AnalysisContext.Provider>
  );
}

export const RideAnalysisView = memo(RideAnalysisViewImpl);

const styles = StyleSheet.create({
  stack: { gap: 12 },
});
