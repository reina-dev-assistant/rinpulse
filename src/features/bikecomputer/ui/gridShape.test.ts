import { describe, expect, test } from 'bun:test';

import { GRID_SIZES } from '../types';
import { gridShape } from './gridShape';

describe('gridShape portrait', () => {
  const [w, h] = [390, 640];
  test.each([
    [1, 1, 1],
    [2, 1, 2],
    [4, 2, 2],
    [6, 2, 3],
    [8, 2, 4],
  ] as const)('%i fields: %i columns x %i rows', (grid, columns, rows) => {
    expect(gridShape(grid, w, h)).toEqual({ columns, rows });
  });
});

describe('gridShape landscape', () => {
  test.each([
    [1, 1, 1],
    [2, 2, 1],
    [6, 3, 2],
    [8, 4, 2],
  ] as const)('%i fields: %i columns x %i rows', (grid, columns, rows) => {
    expect(gridShape(grid, 640, 340)).toEqual({ columns, rows });
  });

  test('four fields: 2x2 normally, one row when the strip is very wide', () => {
    expect(gridShape(4, 640, 340)).toEqual({ columns: 2, rows: 2 });
    expect(gridShape(4, 900, 240)).toEqual({ columns: 4, rows: 1 });
  });
});

describe('gridShape invariants', () => {
  test('columns x rows always equals the field count, for any box', () => {
    for (const [w, h] of [[390, 640], [640, 340], [900, 240], [300, 300], [0, 0], [1, 1000]] as const) {
      for (const grid of GRID_SIZES) {
        const shape = gridShape(grid, w, h);
        expect(shape.columns * shape.rows).toBe(grid);
      }
    }
  });

  test('a square box counts as portrait', () => {
    expect(gridShape(2, 300, 300)).toEqual({ columns: 1, rows: 2 });
  });
});
