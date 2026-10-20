/**
 * JoyoRogo's `sleepInsights` router as JoyoFit calls it (Wawasan tidur). JoyoRogo computes and shows the findings; JoyoFit
 * only reads the consent switch, flips it, and pushes the nightly rows. Kept free of the app's HTTP client so it can be tested
 * with a fake `call`; `rogo.ts` wires it to `rogoCall`.
 */

/** Bit i = weekday i is a free day, 0 = Sunday. */
export interface SleepInsightsStatus {
  enabled: boolean;
  consentVersion: number | null;
  currentVersion: number;
  nights: number;
  latestWakeDate: string | null;
  freeDaysMask: number;
}

/** The room's temperature and humidity over a night, from a bedside thermometer. */
export interface SleepEnvPayload {
  /** Degrees Celsius, -20..60. */
  tempCMean: number;
  tempCMin: number;
  tempCMax: number;
  /** Relative humidity, 0..100. */
  rhPctMean: number;
  rhPctMin: number;
  rhPctMax: number;
  /** Readings behind the summary, at least 1. */
  samples: number;
  source: 'lywsd03mmc';
}

/** One night as `sleepInsights.upsertNights` takes it; see `features/sleep/rogoNights.ts`. */
export interface SleepNightPayload {
  /** Phone local day the night ended, `YYYY-MM-DD`. */
  wakeDate: string;
  onsetMs: number;
  wakeMs: number;
  /** Phone UTC offset in minutes at that time, e.g. 420. */
  tzOffsetMin: number;
  asleepS: number;
  awakeS: number;
  awakenings: number;
  hasStages: boolean;
  deepS: number | null;
  remS: number | null;
  lightS: number | null;
  watchScore: number | null;
  hrvMs: number | null;
  rhrBpm: number | null;
  /** `[startMs, endMs]`, at most 4. */
  naps: [number, number][];
  /** Only when a thermometer covered the night; omitted otherwise. */
  env?: SleepEnvPayload;
}

/** The server accepts at most this many nights per call. */
export const SLEEP_PUSH_BATCH = 14;

export type SleepPushOutcome =
  | { kind: 'ok'; saved: number }
  /** The switch is off on the server (turned off in JoyoRogo meanwhile). */
  | { kind: 'consent_required' }
  /** An older JoyoRogo without the router (404/405). */
  | { kind: 'unsupported' };

export type RogoCaller = <T>(path: string, input: unknown) => Promise<T>;

interface HttpLike {
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

const isUnsupported = (e: unknown): boolean => {
  const status = (e as HttpLike | null)?.status;
  return status === 404 || status === 405;
};

const isConsentRequired = (e: unknown): boolean => {
  const err = e as HttpLike | null;
  return err != null && (err.message === 'consent_required' || err.code === 'consent_required');
};

export function createSleepInsightsClient(call: RogoCaller) {
  return {
    /** The server switch and what it holds; null when JoyoRogo is too old to have the router. */
    async sleepInsightsStatus(): Promise<SleepInsightsStatus | null> {
      try {
        return await call<SleepInsightsStatus>('sleepInsights/status', {});
      } catch (e) {
        if (isUnsupported(e)) return null;
        throw e;
      }
    },
    /** Turns the switch on (stored at `version`) or off (JoyoRogo deletes every night it holds). */
    setSleepInsightsConsent: (enabled: boolean, version: number) =>
      call<SleepInsightsStatus>('sleepInsights/setConsent', { enabled, version }),
    /** At most {@link SLEEP_PUSH_BATCH} nights; each replaces the stored row of its wake date. */
    async pushSleepNights(nights: SleepNightPayload[]): Promise<SleepPushOutcome> {
      try {
        const { saved } = await call<{ saved: number }>('sleepInsights/upsertNights', { nights });
        return { kind: 'ok', saved };
      } catch (e) {
        if (isConsentRequired(e)) return { kind: 'consent_required' };
        if (isUnsupported(e)) return { kind: 'unsupported' };
        throw e;
      }
    },
  };
}
