import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { NavRow } from '@/components/NavRow';
import { Card, Divider, Screen } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { lastUsedRoutineId } from '@/features/strength/watchLive';
import { loadDraft, listRoutines, listStrengthWorkouts } from '@/features/strength/store';
import type { Routine } from '@/features/strength/types';

/**
 * The way into the logger when the watch records a strength workout on its own (`LiveWorkoutProvider`, the Today card, the live screen):
 * a workout already in progress opens at once, otherwise the quick routine picker comes first, the last used routine preselected.
 * "No routine" starts an empty workout. The logger then shows the watch's heart rate and time in its header (`WatchChip`).
 */
export default function WatchPickScreen() {
  const { t } = useTranslation('strength');
  const db = useSQLiteContext();
  const router = useRouter();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if ((await loadDraft(db).catch(() => null)) !== null) {
        if (!cancelled) router.replace('/strength/active');
        return;
      }
      const [all, workouts] = await Promise.all([listRoutines(db), listStrengthWorkouts(db)]);
      if (cancelled) return;
      setPicked(lastUsedRoutineId(all, workouts));
      setRoutines(all);
    })().catch(() => {
      if (!cancelled) router.replace('/strength/active');
    });
    return () => {
      cancelled = true;
    };
  }, [db, router]);

  const start = (routineId: string | null) => router.replace({ pathname: '/strength/active', params: routineId ? { routineId } : {} });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('watchPick.title') }} />
      <AppText variant="body">{t('watchPick.intro')}</AppText>
      {routines === null ? (
        <Skeleton width="100%" height={120} />
      ) : (
        <>
          {routines.length > 0 ? (
            <Card>
              {routines.map((routine, index) => (
                <Fragment key={routine.id}>
                  {index > 0 ? <Divider /> : null}
                  <NavRow
                    icon={picked === routine.id ? 'checkmark-circle' : 'ellipse-outline'}
                    tint={picked === routine.id ? 'workouts' : 'neutral'}
                    title={routine.name}
                    onPress={() => setPicked(routine.id)}
                  />
                </Fragment>
              ))}
            </Card>
          ) : null}
          <Button label={t('watchPick.start')} variant="primary" icon="play" disabled={picked === null} onPress={() => start(picked)} />
          <Button label={t('watchPick.none')} onPress={() => start(null)} />
        </>
      )}
    </Screen>
  );
}
