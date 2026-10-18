import { useMemo, useState } from 'react';

import type { PersonalRecord } from '@/features/strength/calc';
import type { Catalog } from '@/features/strength/catalog';
import type { StrengthWorkout } from '@/features/strength/types';
import { buildStrengthSubject } from '@/features/stickers/data/strength';
import { StickerSheet } from '@/features/stickers/ui/StickerSheet';
import { ThreadsSheet } from '@/features/stickers/ui/ThreadsSheet';
import { useThreadsStrengthSubject } from '@/features/stickers/ui/useThreadsSubject';
import { useLocale } from '@/i18n';

interface Props {
  workout: StrengthWorkout;
  catalog: Catalog;
  records: PersonalRecord[];
  visible: boolean;
  onClose: () => void;
}

/**
 * The sticker sheet of a strength workout and, from its Threads button, the Threads carousel sheet; the button that opens it
 * lives with the other actions of the workout.
 */
export function ShareStrengthSheet({ workout, catalog, records, visible, onClose }: Props) {
  const locale = useLocale();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const subject = useMemo(
    () => buildStrengthSubject({ workout, catalog, records, resolveMuscles: catalog.muscles }, locale),
    [workout, catalog, records, locale],
  );
  const threadsSubject = useThreadsStrengthSubject({ workout, catalog, records }, threadsOpen);
  return (
    <>
      <StickerSheet subject={subject} visible={visible} onClose={onClose} onThreads={() => setThreadsOpen(true)} />
      {threadsSubject ? <ThreadsSheet subject={threadsSubject} visible={threadsOpen} onClose={() => setThreadsOpen(false)} /> : null}
    </>
  );
}
