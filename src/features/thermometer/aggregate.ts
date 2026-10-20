import type { SleepEnvPayload, SleepNightPayload } from '@/cloud/sleepInsightsClient';

import type { EnvSample } from './store';

/** Fewer readings than this is an anecdote, not a night. */
export const MIN_SAMPLES = 6;
/** The share of the sleep window the samples must cover. */
export const MIN_COVERAGE = 0.5;
/** A sample speaks for the time until the next one, but never for more than this: a longer silence is a gap, not a steady room. */
export const MAX_SAMPLE_SPAN_MS = 10 * 60_000;

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * The room over one night, in the shape of the server's `env` field, or undefined when the night is not covered well enough:
 * fewer than {@link MIN_SAMPLES} samples between onset and wake, or samples that speak for less than {@link MIN_COVERAGE} of the window.
 *
 * Coverage adds up, per sample, the time until the next sample inside the window (the last one runs to the wake-up), each capped at
 * {@link MAX_SAMPLE_SPAN_MS}; five-minute samples therefore cover the window and a sensor that dropped out for two hours leaves a hole.
 * Temperature is rounded to 0.1 C and humidity to 0.1 %, the sensor's own resolution at best; `samples` counts what the means are
 * over. `pm25Mean` is not part of this payload (reserved for the air purifier, not sent).
 */
export function roomAggregateForNight(samples: readonly EnvSample[], onsetMs: number, wakeMs: number): SleepEnvPayload | undefined {
  const window = wakeMs - onsetMs;
  if (!(window > 0)) return undefined;
  const inWindow = samples
    .filter((s) => s.ts >= onsetMs && s.ts <= wakeMs && Number.isFinite(s.tempC) && Number.isFinite(s.rhPct))
    .sort((a, b) => a.ts - b.ts);
  if (inWindow.length < MIN_SAMPLES) return undefined;

  let covered = 0;
  for (let i = 0; i < inWindow.length; i++) {
    const until = i + 1 < inWindow.length ? inWindow[i + 1]!.ts : wakeMs;
    covered += Math.min(until - inWindow[i]!.ts, MAX_SAMPLE_SPAN_MS);
  }
  if (covered / window < MIN_COVERAGE) return undefined;

  let tempSum = 0;
  let rhSum = 0;
  let tempMin = Infinity;
  let tempMax = -Infinity;
  let rhMin = Infinity;
  let rhMax = -Infinity;
  for (const s of inWindow) {
    tempSum += s.tempC;
    rhSum += s.rhPct;
    tempMin = Math.min(tempMin, s.tempC);
    tempMax = Math.max(tempMax, s.tempC);
    rhMin = Math.min(rhMin, s.rhPct);
    rhMax = Math.max(rhMax, s.rhPct);
  }
  const n = inWindow.length;
  return {
    tempCMean: round(tempSum / n, 1),
    tempCMin: round(tempMin, 1),
    tempCMax: round(tempMax, 1),
    rhPctMean: round(rhSum / n, 1),
    rhPctMin: round(rhMin, 1),
    rhPctMax: round(rhMax, 1),
    samples: n,
    source: 'lywsd03mmc',
  };
}

/**
 * The aggregate of each night by wake date, for `buildRogoNights(..., env)`. A night in several sensors' samples (the person replaced
 * the sensor) is summarised from the sensor that heard the most of it; samples of two sensors are never mixed.
 */
export function roomEnvByWakeDate(nights: readonly Pick<SleepNightPayload, 'wakeDate' | 'onsetMs' | 'wakeMs'>[], samples: readonly EnvSample[]): Map<string, SleepEnvPayload> {
  const bySensor = new Map<string, EnvSample[]>();
  for (const s of samples) {
    const list = bySensor.get(s.sensorId);
    if (list) list.push(s);
    else bySensor.set(s.sensorId, [s]);
  }
  const out = new Map<string, SleepEnvPayload>();
  for (const night of nights) {
    let best: SleepEnvPayload | undefined;
    for (const list of bySensor.values()) {
      const env = roomAggregateForNight(list, night.onsetMs, night.wakeMs);
      if (env && (!best || env.samples > best.samples)) best = env;
    }
    if (best) out.set(night.wakeDate, best);
  }
  return out;
}
