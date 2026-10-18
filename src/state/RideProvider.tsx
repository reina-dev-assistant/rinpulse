import Constants from 'expo-constants';
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { cloudLog as log } from '@/cloud/log';
import { t } from '@/i18n';
import type { FinishResult } from '@/features/record/controller';
import { joinRoom, rideSocketUrl } from '@/features/ride/api';
import { RideSession, type RideSnapshot, type SocketLike } from '@/features/ride/session';
import { sensorHub } from '@/features/sensors/instance';
import { getWheelMm } from '@/features/sensors/settings';
import { userWeightKg } from '@/features/strength/profile';
import { useRecorder } from '@/state/RecorderProvider';

export interface RideContextValue {
  snapshot: RideSnapshot;
  /** Joins the room with this code (the game shows it, and in the QR). Failures land in `snapshot.error`. */
  join: (code: string) => Promise<void>;
  /** Leaves the room; a recording that already started keeps running as an ordinary indoor ride. */
  leave: () => Promise<void>;
  /** After `snapshot.phase` is `lost`: tries the same room again. */
  reconnect: () => void;
  /** One gear harder (1) or easier (-1) in the game. */
  gear: (d: 1 | -1) => void;
  /** "Mulai": starts the recording; the game is told. */
  start: () => void;
  /** The person went on after the game asked to stop. */
  dismissStop: () => void;
  /**
   * Ends the ride: the game is told to stop and given a moment for its summary, then the workout is saved with the game's distance
   * and climb (the recorder's `finish`, with the Strava choice), and the relay is told the summary is safe. Rejects when saving fails;
   * the recording is kept and this can be called again.
   */
  finish: (options: { strava: boolean }) => Promise<FinishResult | null>;
  /** Throws the ride away; the game is told to stop. */
  discard: () => Promise<void>;
}

const RideContext = createContext<RideContextValue | null>(null);

export function useRide(): RideContextValue {
  const value = useContext(RideContext);
  if (!value) throw new Error('useRide must be used inside <RideProvider>');
  return value;
}

/**
 * The phone's ride room for the whole app (see `features/ride/session.ts`): the connection and the stream survive leaving the screen.
 * Must sit inside `RecorderProvider` and `SensorsProvider`.
 */
export function RideProvider({ children }: { children: ReactNode }) {
  const { controller, finish: finishRecording, discard: discardRecording } = useRecorder();

  const session = useMemo(
    () =>
      new RideSession({
        join: joinRoom,
        socketUrl: rideSocketUrl,
        openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
        hub: sensorHub,
        recorder: controller,
        now: Date.now,
        massKg: userWeightKg,
        wheelCircumferenceM: () => getWheelMm() / 1000,
        app: `JoyoFit ${Constants.expoConfig?.version ?? ''}`.trim(),
        title: () => t('ride:notificationTitle'),
        log: (message) => log(message),
      }),
    [controller],
  );

  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const finish = useCallback(
    async (options: { strava: boolean }) => {
      const sum = await session.requestStop();
      const virtual = sum ? { distM: sum.distM, elevM: sum.elevM, route: sum.route, laps: sum.laps } : undefined;
      const result = await finishRecording({ strava: options.strava, virtual });
      session.confirmSummary();
      return result;
    },
    [finishRecording, session],
  );

  const discard = useCallback(async () => {
    session.endGame();
    await discardRecording();
    session.confirmSummary();
  }, [discardRecording, session]);

  const value = useMemo<RideContextValue>(
    () => ({
      snapshot,
      join: (code) => session.join(code),
      leave: () => session.leave(),
      reconnect: () => session.reconnect(),
      gear: (d) => session.gear(d),
      start: () => session.start(),
      dismissStop: () => session.dismissStop(),
      finish,
      discard,
    }),
    [discard, finish, session, snapshot],
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}
