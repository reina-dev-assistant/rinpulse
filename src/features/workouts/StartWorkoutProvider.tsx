import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { pickFitFile } from '@/features/fitimport/useFitImport';
import { LIVE_ROUTE, OPEN_LIVE } from '@/features/record/liveRoute';
import { StartWorkoutSheet } from '@/features/workouts/ui/StartWorkoutSheet';
import { errorMessage } from '@/format';
import { useRecorder } from '@/state/RecorderProvider';

interface StartWorkoutValue {
  /** Opens the "Start workout" sheet over whatever screen is showing. */
  open: () => void;
}

const StartWorkoutContext = createContext<StartWorkoutValue>({ open: () => {} });

/**
 * Owns the one "Start workout" sheet (record on the phone, strength logger, workout by hand, FIT file, Loop). The centre button of the
 * tab bar opens it through `useStartWorkout`, so it is the same sheet from every tab. Mounted above the tab navigator, inside the recorder provider.
 */
export function StartWorkoutProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useTranslation(['workouts', 'common']);
  const { snapshot } = useRecorder();
  const [visible, setVisible] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const open = useCallback(() => setVisible(true), []);
  const value = useMemo(() => ({ open }), [open]);

  /** The picker here, the import and its result on the FIT import screen. */
  const importFit = async () => {
    try {
      const picked = await pickFitFile();
      if (picked) router.push({ pathname: '/settings/import-fit', params: { uri: picked.uri } });
    } catch (e) {
      setPickError(errorMessage(e));
    }
  };

  return (
    <StartWorkoutContext.Provider value={value}>
      {children}
      <StartWorkoutSheet
        visible={visible}
        onClose={() => setVisible(false)}
        recording={snapshot.phase !== 'idle'}
        onRecord={() => router.navigate(LIVE_ROUTE, OPEN_LIVE)}
        onStrength={() => router.push('/strength')}
        onManual={() => router.push('/workouts/manual')}
        onImportFit={() => void importFit()}
        onLoop={() => router.push('/routes/loop')}
      />
      <ConfirmDialog
        visible={pickError !== null}
        title={t('workouts:list.start.fit.title')}
        message={t('workouts:list.pickError', { error: pickError ?? '' })}
        confirmLabel={t('common:actions.close')}
        onConfirm={() => setPickError(null)}
        onCancel={() => setPickError(null)}
      />
    </StartWorkoutContext.Provider>
  );
}

export function useStartWorkout(): StartWorkoutValue {
  return useContext(StartWorkoutContext);
}
