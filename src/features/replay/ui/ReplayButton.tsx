import { useMemo, useState } from 'react';

import { Button } from '@/components/Button';
import type { WorkoutRow } from '@/db/queries';
import type { RideClimb } from '@/features/cycling/types';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { sportLabel } from '@/features/workouts/sportLabel';
import { useTranslation } from '@/i18n';

import { trackFromAnalysis } from '../track';
import { ReplayScreen } from './ReplayScreen';

interface Props {
  workout: WorkoutRow;
  analysis: WorkoutAnalysis | null;
  /** The ride's climbs, for the climb pin; null for anything else. */
  climbs: readonly RideClimb[] | null;
}

/** "Putar ulang" of a workout with a GPS track: opens the replay player. Nothing is drawn for a workout without one. */
export function ReplayButton({ workout, analysis, climbs }: Props) {
  const { t } = useTranslation('replay');
  const [open, setOpen] = useState(false);
  const track = useMemo(
    () => (analysis ? trackFromAnalysis(analysis, { climbs: climbs?.map((c) => ({ startM: c.startM, endM: c.endM, gainM: c.gainM, lengthM: c.lengthM })) }) : null),
    [analysis, climbs],
  );
  // The label follows the language: `useTranslation` re-renders this on a switch.
  const label = sportLabel(workout.sportName);
  if (!track) return null;
  return (
    <>
      <Button label={t('entry.button')} icon="play-circle-outline" onPress={() => setOpen(true)} />
      <ReplayScreen track={track} sportLabel={label} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
