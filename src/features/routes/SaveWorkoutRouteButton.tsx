import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice } from '@/components/States';
import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';

import { formatRouteDate } from './copy';
import type { SavedRoute } from './routeModel';
import { saveRoute } from './routeStore';
import { workoutRouteDraft } from './workoutRoute';
import { sportLabel } from '@/features/workouts/sportLabel';

interface SaveWorkoutRouteInput {
  workout: Pick<WorkoutRow, 'sportName' | 'start'>;
  /** The workout's stored points, already loaded by the screen. */
  points: readonly WorkoutPointRow[];
}

export interface SaveWorkoutRoute {
  /** False when the workout has no usable track: there is nothing to save and nothing to draw. */
  available: boolean;
  saving: boolean;
  saved: SavedRoute | null;
  error: string | null;
  save: () => void;
}

/** The state of "Simpan sebagai rute" for a workout: saves its GPS track as a route. The button and its feedback are drawn apart, so the button can sit in a row of actions. */
export function useSaveWorkoutRoute({ workout, points }: SaveWorkoutRouteInput): SaveWorkoutRoute {
  const { t } = useTranslation('routes');
  const draft = useMemo(
    () => workoutRouteDraft(t('workoutPicker.defaultName', { sport: sportLabel(workout.sportName), date: formatRouteDate(workout.start * 1000) }), points),
    [workout.sportName, workout.start, points, t],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    saveRoute(draft)
      .then(setSaved)
      .catch((e: unknown) => setError(t('workoutPicker.saveFailed', { message: errorMessage(e) })))
      .finally(() => setSaving(false));
  };

  return { available: draft !== null, saving, saved, error, save };
}

/** "Simpan sebagai rute" / "Save as route"; renders nothing when the workout has no usable track. */
export function SaveWorkoutRouteButton({ route, iconOnly }: { route: SaveWorkoutRoute; iconOnly?: boolean }) {
  const { t } = useTranslation('routes');
  if (!route.available) return null;
  return (
    <Button
      label={route.saving ? t('workout.saving') : t('workout.save')}
      icon="trail-sign"
      iconOnly={iconOnly}
      loading={route.saving}
      done={route.saved !== null}
      disabled={route.saved !== null}
      onPress={route.save}
    />
  );
}

/** The result of saving: the saved route with a link to it, or why it failed. Renders nothing before a save. */
export function SaveWorkoutRouteNotice({ route }: { route: SaveWorkoutRoute }) {
  const { t } = useTranslation('routes');
  const router = useRouter();
  if (route.saved === null && route.error === null) return null;
  return (
    <View style={styles.box}>
      {route.saved !== null ? (
        <Notice
          icon="checkmark-circle"
          action={{ label: t('workout.open'), onPress: () => router.push({ pathname: '/routes/[id]', params: { id: route.saved!.id } }) }}>
          {t('workout.saved', { name: route.saved.name })}
        </Notice>
      ) : null}
      {route.error !== null ? <Notice tone="danger">{route.error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
});
