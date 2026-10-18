/** Columns and rows of a data page for a field count and the space it has. Pure: no React Native. */
import type { GridSize } from '../types';

export interface GridShape {
  columns: number;
  rows: number;
}

/** Wider than this (width / height) four fields go in one row instead of 2 x 2: the usable area beside a landscape control column is about 1.7:1. */
export const ROW_OF_FOUR_ASPECT = 3;

/**
 * Portrait (or square): 1 = 1x1, 2 = two rows, 4 = 2x2, 6 = three rows of two, 8 = four rows of two.
 * Landscape: 1 = 1x1, 2 = two columns, 4 = one row of four when very wide else 2x2, 6 = 3x2, 8 = 4x2.
 * Cells are always whole; `columns * rows === grid`.
 */
export function gridShape(grid: GridSize, width: number, height: number): GridShape {
  const landscape = width > height;
  switch (grid) {
    case 1:
      return { columns: 1, rows: 1 };
    case 2:
      return landscape ? { columns: 2, rows: 1 } : { columns: 1, rows: 2 };
    case 4:
      return landscape && height > 0 && width / height >= ROW_OF_FOUR_ASPECT ? { columns: 4, rows: 1 } : { columns: 2, rows: 2 };
    case 6:
      return landscape ? { columns: 3, rows: 2 } : { columns: 2, rows: 3 };
    case 8:
      return landscape ? { columns: 4, rows: 2 } : { columns: 2, rows: 4 };
  }
}
