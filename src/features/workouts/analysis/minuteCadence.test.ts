import { describe, expect, it } from 'bun:test';

import { minuteCadenceGrid } from './minuteCadence';

const START = 1_760_000_030;

describe('minuteCadenceGrid', () => {
  it('holds each full minute across the grid samples it covers and leaves gaps between', () => {
    // A 5 minute workout on a 10 s grid (31 samples). The minutes start at START + 30 (not aligned to the workout), so the
    // first full minute is at +30 s; the one at +90 s has no row (a gap); +150 s and +210 s count; the last is cut by the end.
    const samples = [
      { timestamp: START + 30, steps: 120 },
      { timestamp: START + 150, steps: 130 },
      { timestamp: START + 210, steps: 140 },
      { timestamp: START + 270, steps: 150 },
    ];
    const grid = minuteCadenceGrid(samples, START, START + 300, 10, 31)!;
    expect(grid[2]).toBeNull();
    expect(grid[3]).toBe(120);
    expect(grid[8]).toBe(120);
    expect(grid[9]).toBeNull();
    expect(grid[14]).toBeNull();
    expect(grid[15]).toBe(130);
    expect(grid[20]).toBe(130);
    expect(grid[21]).toBe(140);
    expect(grid[26]).toBe(140);
    // 270 + 60 = 330 s is past the end at 300 s: not a full minute.
    expect(grid[27]).toBeNull();
    expect(grid[30]).toBeNull();
  });

  it('drops minutes outside the workout and counts under 40 or over 260 steps as a stop, not a cadence', () => {
    const samples = [
      { timestamp: START - 60, steps: 120 },
      { timestamp: START + 0, steps: 39 },
      { timestamp: START + 60, steps: 261 },
      { timestamp: START + 120, steps: 0 },
      { timestamp: START + 180, steps: 40 },
    ];
    const grid = minuteCadenceGrid(samples, START, START + 600, 10, 61)!;
    expect(grid.filter((v) => v !== null)).toEqual([40, 40, 40, 40, 40, 40]);
  });

  it('is null without a usable minute', () => {
    expect(minuteCadenceGrid([], START, START + 300, 10, 31)).toBeNull();
    expect(minuteCadenceGrid([{ timestamp: START + 5, steps: 100 }], START, START + 50, 10, 6)).toBeNull();
  });
});
