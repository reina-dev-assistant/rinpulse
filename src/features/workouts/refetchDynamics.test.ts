import { describe, expect, it } from 'bun:test';

import type { WorkoutRefetchOutcome, WorkoutRefetchReport } from '@/wear';

import {
  canRefetch,
  lacksDynamics,
  parseTried,
  refetchRuns,
  resultParts,
  settledStarts,
  showsRefetch,
  type RefetchApi,
  type RefetchAvailability,
  type RefetchRow,
} from './refetchDynamics';

const NO_FORM = { kind: 'RUNNING', samples: { avgHr: 150, avgCadence: 168 } };

function run(start: number, summary: RefetchRow['summary'] = NO_FORM, sportName = 'Running'): RefetchRow {
  return { start, sportName, summary };
}

const AVAILABLE: RefetchAvailability = { native: true, connected: true, address: 'AA:01', workoutDevice: 'AA:01' };

describe('lacksDynamics', () => {
  it('is true for a summary with none or only the old contact-time mean', () => {
    expect(lacksDynamics({})).toBe(true);
    expect(lacksDynamics(NO_FORM)).toBe(true);
    // The older sync kept only this mean, polluted with zero readings: it does not count as dynamics.
    expect(lacksDynamics({ samples: { avgGroundContactTime: 131 } })).toBe(true);
  });

  it('is false once a series or one of the newer means is there', () => {
    expect(lacksDynamics({ dynamics: { stepSec: 60, gct: [240, 250] } })).toBe(false);
    expect(lacksDynamics({ samples: { avgVerticalOscillation: 8.7 } })).toBe(false);
    expect(lacksDynamics({ samples: { avgVerticalRatio: 7.3 } })).toBe(false);
    expect(lacksDynamics({ samples: { avgGroundContactBalance: 50 } })).toBe(false);
    expect(lacksDynamics({ samples: { avgHangTimeMs: 120 } })).toBe(false);
  });
});

describe('canRefetch', () => {
  it('offers a watch run or walk without dynamics', () => {
    expect(canRefetch(run(1), new Set())).toBe(true);
    expect(canRefetch(run(2, { kind: 'WALKING' }, 'Walking'), new Set())).toBe(true);
    expect(canRefetch(run(3, NO_FORM, 'Trail Running'), new Set())).toBe(true);
  });

  it('leaves out other sports, a phone recording, a run with dynamics and one the watch already answered for', () => {
    expect(canRefetch(run(1, { kind: 'CYCLING' }, 'Cycling'), new Set())).toBe(false);
    expect(canRefetch(run(1, { kind: 'POOL_SWIM' }, 'Pool Swimming'), new Set())).toBe(false);
    expect(canRefetch(run(1, { ...NO_FORM, source: 'phone' }), new Set())).toBe(false);
    expect(canRefetch(run(1, { ...NO_FORM, dynamics: { gct: [240, 250, 260] } }), new Set())).toBe(false);
    expect(canRefetch(run(1), new Set([1]))).toBe(false);
  });
});

describe('showsRefetch', () => {
  it('shows with the native function, the recording watch connected and a candidate', () => {
    expect(showsRefetch(AVAILABLE, run(1), new Set())).toBe(true);
  });

  it('hides on a binary without the native function', () => {
    expect(showsRefetch({ ...AVAILABLE, native: false }, run(1), new Set())).toBe(false);
  });

  it('hides without a link that is up and idle', () => {
    expect(showsRefetch({ ...AVAILABLE, connected: false }, run(1), new Set())).toBe(false);
    expect(showsRefetch({ ...AVAILABLE, address: null }, run(1), new Set())).toBe(false);
  });

  it('hides for a workout another watch recorded, an import and one from before the attribution', () => {
    expect(showsRefetch({ ...AVAILABLE, workoutDevice: 'BB:02' }, run(1), new Set())).toBe(false);
    expect(showsRefetch({ ...AVAILABLE, workoutDevice: null }, run(1), new Set())).toBe(false);
  });

  it('hides once the watch answered for it, and for a run that already has dynamics', () => {
    expect(showsRefetch(AVAILABLE, run(1), new Set([1]))).toBe(false);
    expect(showsRefetch(AVAILABLE, run(1, { samples: { avgVerticalOscillation: 8.7 } }), new Set())).toBe(false);
  });
});

function report(...results: [number, WorkoutRefetchOutcome][]): WorkoutRefetchReport {
  const count = (outcome: WorkoutRefetchOutcome) => results.filter(([, o]) => o === outcome).length;
  return {
    requested: results.length,
    updated: count('updated'),
    unchanged: count('unchanged'),
    noDynamics: count('no_dynamics'),
    gone: count('gone'),
    failed: count('failed'),
    results: results.map(([start, outcome]) => ({ start, outcome })),
  };
}

describe('refetchRuns', () => {
  it('asks one workout at a time and reports progress after each', async () => {
    const asked: number[][] = [];
    const outcomes: Record<number, WorkoutRefetchOutcome> = { 1: 'updated', 2: 'gone', 3: 'gone', 4: 'no_dynamics', 5: 'failed' };
    const api: RefetchApi = {
      refetchWorkoutData: async (starts) => {
        asked.push(starts);
        return report(...starts.map((s): [number, WorkoutRefetchOutcome] => [s, outcomes[s]!]));
      },
    };
    const progress: string[] = [];

    const result = await refetchRuns([1, 2, 3, 4, 5], api, (p) => progress.push(`${p.done}/${p.total}`));

    expect(asked).toEqual([[1], [2], [3], [4], [5]]);
    expect(progress).toEqual(['0/5', '1/5', '2/5', '3/5', '4/5', '5/5']);
    expect(result.totals).toEqual({ requested: 5, updated: 1, unchanged: 0, noDynamics: 1, gone: 2, failed: 1 });
    expect(result.error).toBeNull();
    expect(settledStarts(result).sort()).toEqual([2, 3, 4]);
  });

  it('keeps what was done when the link drops and returns the error', async () => {
    const boom = new Error('ERR_DISCONNECTED');
    const api: RefetchApi = {
      refetchWorkoutData: async ([start]) => {
        if (start === 3) throw boom;
        return report([start!, 'updated']);
      },
    };

    const result = await refetchRuns([1, 2, 3, 4], api);

    expect(result.totals.updated).toBe(2);
    expect(result.totals.requested).toBe(2);
    expect(result.error).toBe(boom);
  });

  it('stops between workouts when asked to', async () => {
    let calls = 0;
    const api: RefetchApi = {
      refetchWorkoutData: async ([start]) => {
        calls += 1;
        return report([start!, 'updated']);
      },
    };

    const result = await refetchRuns([1, 2, 3], api, undefined, () => calls >= 1);

    expect(calls).toBe(1);
    expect(result.totals.updated).toBe(1);
  });

  it('settles nothing for a failed workout, so it can be tried again', async () => {
    const api: RefetchApi = { refetchWorkoutData: async ([start]) => report([start!, 'failed']) };

    expect(settledStarts(await refetchRuns([7], api))).toEqual([]);
  });

  it('ignores an outcome a newer native build might add', async () => {
    const api: RefetchApi = {
      refetchWorkoutData: async ([start]) => ({ ...report([start!, 'updated']), results: [{ start: start!, outcome: 'strange' as WorkoutRefetchOutcome }] }),
    };

    const result = await refetchRuns([1], api);

    expect(result.totals.requested).toBe(0);
  });
});

describe('resultParts', () => {
  it('lists the non-zero counts in reading order', () => {
    expect(resultParts({ requested: 9, updated: 3, unchanged: 0, noDynamics: 1, gone: 5, failed: 0 })).toEqual([
      { key: 'updated', count: 3 },
      { key: 'noDynamics', count: 1 },
      { key: 'gone', count: 5 },
    ]);
    expect(resultParts({ requested: 0, updated: 0, unchanged: 0, noDynamics: 0, gone: 0, failed: 0 })).toEqual([]);
  });
});

describe('parseTried', () => {
  it('reads the stored starts and survives damage', () => {
    expect([...parseTried('[1,2,3]')]).toEqual([1, 2, 3]);
    expect(parseTried(null).size).toBe(0);
    expect(parseTried('not json').size).toBe(0);
    expect(parseTried('{"a":1}').size).toBe(0);
    expect([...parseTried('[1,"x",null,2]')]).toEqual([1, 2]);
  });
});
