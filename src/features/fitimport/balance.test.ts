import { describe, expect, it } from 'bun:test';

import { FitWriter, toFitTime } from '../strava/fitEncoder';
import { parseFitActivity } from './parseFit';

const START = 1_792_058_016;

/** A minimal bike activity whose records carry `left_right_balance` (field 30: 7 bits percent, 0x80 = the percent is the right pedal's). */
function file(balances: (number | null)[], sessionBalance: number | null = null): Uint8Array {
  const fit = new FitWriter();
  const id = fit.define(0, 0, [{ num: 0, type: 'enum' }, { num: 4, type: 'uint32' }]);
  fit.write(id, [4, toFitTime(START)]);
  const record = fit.define(1, 20, [
    { num: 253, type: 'uint32' },
    { num: 7, type: 'uint16' },
    { num: 30, type: 'uint8' },
  ]);
  balances.forEach((b, i) => fit.write(record, [toFitTime(START + i), 200, b]));
  const session = fit.define(2, 18, [
    { num: 253, type: 'uint32' },
    { num: 2, type: 'uint32' },
    { num: 5, type: 'enum' },
    { num: 7, type: 'uint32' },
    { num: 8, type: 'uint32' },
    { num: 37, type: 'uint16' },
  ]);
  fit.write(session, [toFitTime(START + balances.length), toFitTime(START), 2, balances.length * 1000, balances.length * 1000, sessionBalance]);
  return fit.finish();
}

describe('pedal balance from a FIT file', () => {
  it('averages the records: a right flag means the percent is the right pedal, so left is the rest', () => {
    const a = parseFitActivity(file([0x80 | 52, 0x80 | 52, 48, 48]));
    expect('ok' in a).toBe(false);
    if ('ok' in a) return;
    // 52 % right = 48 % left, and 48 % left: 48 on both.
    expect(a.balanceLeftPct).toBe(48);
  });

  it('is null when the file has none', () => {
    const a = parseFitActivity(file([null, null, null]));
    if ('ok' in a) throw new Error(a.message);
    expect(a.balanceLeftPct).toBeNull();
  });

  it('falls back to the session value (hundredths, right flag 0x8000)', () => {
    const a = parseFitActivity(file([null, null, null], 0x8000 | 4984));
    if ('ok' in a) throw new Error(a.message);
    expect(a.balanceLeftPct).toBe(50.2);
  });

  it('ignores a share that is not between 0 and 100', () => {
    const a = parseFitActivity(file([0, 100, 0x80]));
    if ('ok' in a) throw new Error(a.message);
    expect(a.balanceLeftPct).toBeNull();
  });
});
