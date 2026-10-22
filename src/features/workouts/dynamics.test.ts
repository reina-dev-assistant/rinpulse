import { describe, expect, it } from 'bun:test';

import { runningDynamics } from './dynamics';

describe('runningDynamics', () => {
  it('is null when the watch sent no running form', () => {
    expect(runningDynamics({})).toBeNull();
    expect(runningDynamics({ samples: { avgCadence: 170, avgStepLength: 105 } })).toBeNull();
  });

  it('reads the means from the sample averages', () => {
    const result = runningDynamics({
      samples: { avgGroundContactTime: 252, avgVerticalOscillation: 8.9, avgVerticalRatio: 7.2, avgGroundContactBalance: 50.4 },
    });
    expect(result?.averages).toEqual({ gct: 252, vo: 8.9, vr: 7.2, gtb: 50.4 });
    expect(result?.series).toEqual([]);
  });

  it('leaves out a metric the watch did not send and one outside its range', () => {
    const result = runningDynamics({ samples: { avgGroundContactTime: 0, avgVerticalOscillation: 8.9, avgVerticalRatio: 99 } });
    expect(result?.averages).toEqual({ gct: null, vo: 8.9, vr: null, gtb: null });
  });

  it('keeps a chart only for a metric with at least three readings', () => {
    const result = runningDynamics({
      samples: { avgGroundContactTime: 250 },
      dynamics: { start: 1_700_000_000, stepSec: 60, gct: [240, null, 260, 250], vo: [8.4, 9.0, null, null] },
    });
    expect(result?.series.map((s) => s.metric)).toEqual(['gct']);
    const gct = result!.series[0]!;
    expect(gct.values).toEqual([240, null, 260, 250]);
    expect(gct.min).toBe(240);
    expect(gct.max).toBe(260);
    expect(gct.stepSec).toBe(60);
    // Two vertical oscillation buckets are too few for a chart, and with no sample mean there is nothing to show for it.
    expect(result?.averages.vo).toBeNull();
  });

  it('drops out-of-range buckets from a chart', () => {
    const result = runningDynamics({ dynamics: { gct: [0, 5000, 240, 250, 260] } });
    expect(result?.series[0]?.values).toEqual([null, null, 240, 250, 260]);
    expect(result?.averages.gct).toBe(250);
  });

  it('tolerates a malformed series', () => {
    expect(runningDynamics({ dynamics: { gct: 'x' as unknown as number[] } })).toBeNull();
    expect(runningDynamics({ dynamics: { stepSec: -5, gct: [240, 250, 260] } })?.series[0]?.stepSec).toBe(60);
  });
});
