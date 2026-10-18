import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { SPORT_ROWS, type ManualSport } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { useRecorder } from '@/state/RecorderProvider';

/**
 * Keeps the GPS warming up while the picker is on screen and in front: from the moment `enabled` (an outdoor sport with precise
 * location already allowed) until the screen loses focus (the sensors page opens over it), the app goes to the background or the
 * picker closes without a recording. Coming back starts it again. The recorder takes the running warm-up over at "Mulai".
 */
export function useGpsWarmUp(sport: ManualSport, enabled: boolean): void {
  const { warmUp, stopWarmUp } = useRecorder();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const title = sportLabel(SPORT_ROWS[sport].name);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !foreground) return undefined;
      void warmUp(sport, title);
      return () => void stopWarmUp();
    }, [enabled, foreground, sport, title, warmUp, stopWarmUp]),
  );
}
