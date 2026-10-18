import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChoiceDialog } from '@/components/ChoiceDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { findWorkoutPosts } from '@/features/workouts/deleteWorkout';
import { scheduleWorkoutDelete } from '@/features/workouts/pendingDelete';
import { sportLabel } from '@/features/workouts/sportLabel';
import { formatDateTime } from '@/format';
import { useWatch } from '@/state/WatchProvider';

/** The workout to delete: `start` in unix seconds, `sportName` as stored. */
export interface DeleteTarget {
  start: number;
  sportName: string;
  /** What the person calls it (a strength workout's name); the sport's name when empty. */
  name?: string;
}

interface Props {
  target: DeleteTarget | null;
  onClose: () => void;
  /** The person confirmed: the workout is hidden and the 5 seconds of "Urungkan" have started. */
  onConfirmed?: () => void;
}

/**
 * "Hapus latihan": says what goes and what stays (Strava), and when the workout was shared to the feed asks whether the post goes too.
 * The posts are looked up while the dialog is open; the answer arrives in the same dialog.
 */
export function DeleteWorkoutDialog({ target, onClose, onConfirmed }: Props) {
  const db = useSQLiteContext();
  const { t } = useTranslation('workouts');
  const { dataChanged } = useWatch();
  const [found, setFound] = useState<{ start: number; ids: string[] } | null>(null);
  const start = target?.start ?? null;
  // The lookup of another workout (a dialog opened earlier) is not this one's answer.
  const posts = found !== null && found.start === start ? found.ids : [];

  useEffect(() => {
    if (start === null) return;
    let live = true;
    void findWorkoutPosts(start).then((ids) => {
      if (live) setFound({ start, ids });
    });
    return () => {
      live = false;
    };
  }, [start]);

  if (target === null) return null;
  const sport = target.name?.trim() || sportLabel(target.sportName);
  const text = { sport, date: formatDateTime(target.start) };
  const run = (postIds: string[]) => {
    scheduleWorkoutDelete(db, { start: target.start, label: sport, postIds, onDeleted: dataChanged });
    onClose();
    onConfirmed?.();
  };

  if (posts.length > 0) {
    return (
      <ChoiceDialog
        visible
        title={t('delete.title')}
        message={t('delete.withPost', text)}
        choices={[
          { label: t('delete.withPostYes'), variant: 'destructive', onPress: () => run(posts) },
          { label: t('delete.withPostNo'), variant: 'secondary', onPress: () => run([]) },
        ]}
        onCancel={onClose}
      />
    );
  }
  return <ConfirmDialog visible title={t('delete.title')} message={t('delete.message', text)} confirmLabel={t('delete.confirm')} destructive onConfirm={() => run([])} onCancel={onClose} />;
}
