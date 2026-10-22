import { useCallback, useRef, useState } from 'react';

import { HuaweiWear, hasNative } from '@/wear';
import { useWatch } from '@/state/WatchProvider';

import { refetchRuns, settledStarts, type RefetchProgress, type RefetchRun } from './refetchDynamics';
import { readTried, rememberTried } from './refetchQuery';

export type RefetchState = { status: 'idle' } | { status: 'running'; progress: RefetchProgress } | { status: 'done'; run: RefetchRun };

/**
 * The "Ambil ulang dari jam" action shared by the workout screen and Settings: the gates (the binary has the native function, the link is
 * up and idle, which watch it is), the runs the watch already answered for, and one run at a time with its progress and result.
 */
export function useRefetchDynamics() {
  const { linkState, device, dataChanged } = useWatch();
  const [state, setState] = useState<RefetchState>({ status: 'idle' });
  const [tried, setTried] = useState(readTried);
  const running = useRef(false);

  const run = useCallback(
    async (starts: readonly number[]): Promise<RefetchRun | null> => {
      if (running.current || starts.length === 0) return null;
      running.current = true;
      setState({ status: 'running', progress: { done: 0, total: starts.length } });
      try {
        const result = await refetchRuns(starts, HuaweiWear, (progress) => setState({ status: 'running', progress }));
        const settled = settledStarts(result);
        if (settled.length > 0) setTried(rememberTried(settled));
        // The native side wrote the summaries: screens re-read, and the cloud upload picks up the workouts whose `rev` moved.
        if (result.totals.updated > 0) dataChanged();
        setState({ status: 'done', run: result });
        return result;
      } finally {
        running.current = false;
      }
    },
    [dataChanged],
  );

  const clear = useCallback(() => setState({ status: 'idle' }), []);

  return {
    /** An installed binary older than the native change has no such function: the controls stay hidden. */
    native: hasNative('refetchWorkoutData'),
    connected: linkState === 'connected' && device !== null,
    address: device?.address ?? null,
    tried,
    state,
    run,
    clear,
  };
}
