import { describe, expect, it } from 'bun:test';

import { GUIDE_CUES, guideState, parseGuide } from './guide';

const START = 1_760_000_000_000;
const at = (sec: number) => START + sec * 1000;

describe('guideState', () => {
  const g = { startedAt: START };

  it('runs 15 minutes warm-up, 30 minutes effort (10 settling, 20 measured), 10 minutes cool-down', () => {
    expect(guideState(g, at(0))).toMatchObject({ phase: 'warmup', leftSec: 900, lengthSec: 900 });
    expect(guideState(g, at(899))).toMatchObject({ phase: 'warmup', leftSec: 1 });
    expect(guideState(g, at(900))).toMatchObject({ phase: 'effort', leftSec: 1800, measuring: false });
    expect(guideState(g, at(900 + 599))).toMatchObject({ phase: 'effort', measuring: false });
    expect(guideState(g, at(900 + 600))).toMatchObject({ phase: 'effort', measuring: true, leftSec: 1200 });
    expect(guideState(g, at(900 + 1800))).toMatchObject({ phase: 'cooldown', leftSec: 600 });
    expect(guideState(g, at(900 + 1800 + 600))).toMatchObject({ phase: 'done', leftSec: 0 });
  });

  it('says when the effort is in unix seconds, the clock of the workout points', () => {
    const s = guideState(g, at(10));
    expect(s.effortStart).toBe(START / 1000 + 900);
    expect(s.effortEnd).toBe(START / 1000 + 900 + 1800);
  });

  it('puts the cues at the effort start, ten minutes in and the end', () => {
    expect(GUIDE_CUES.map((c) => c.afterSec)).toEqual([900, 1500, 2700]);
  });
});

describe('parseGuide', () => {
  it('reads a guide, drops a forgotten one and rubbish', () => {
    expect(parseGuide(JSON.stringify({ startedAt: START }), START + 1000)).toEqual({ startedAt: START });
    expect(parseGuide(JSON.stringify({ startedAt: START }), START + 25 * 3600 * 1000)).toBeNull();
    expect(parseGuide('nope', START)).toBeNull();
    expect(parseGuide(null, START)).toBeNull();
    expect(parseGuide(JSON.stringify({ startedAt: START + 10 * 3600 * 1000 }), START)).toBeNull();
  });
});
