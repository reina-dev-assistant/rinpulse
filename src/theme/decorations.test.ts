import { describe, expect, test } from 'bun:test';

import { DECORATION_COLORS, DECORATION_HEIGHT, DECORATION_WIDTH, decorationPaths } from './decorations';
import { THEMES, type DecorationId } from './themes';

const IDS = Object.keys(DECORATION_COLORS) as DecorationId[];

describe('decorations', () => {
  test('every decoration is used by a theme, and every theme decoration is drawn', () => {
    const used = THEMES.flatMap((theme) => (theme.decoration ? [theme.decoration] : []));
    expect(new Set(used)).toEqual(new Set(IDS));
    // Sogan has the batik; the other motifs go to at most a handful of themes.
    expect(THEMES.find((theme) => theme.id === 'sogan')?.decoration).toBe('kawung');
  });

  test.each(IDS)('%s is drawn faintly, in few paths, at full size and in a preview box', (id) => {
    for (const [width, height] of [
      [DECORATION_WIDTH, DECORATION_HEIGHT],
      [120, 64],
    ] as const) {
      const paths = decorationPaths(id, width, height);
      expect(paths.length).toBeGreaterThan(0);
      // Merged by tone, kind and opacity step: a motif is a few dozen paths, never one per piece.
      expect(paths.length).toBeLessThan(80);
      for (const path of paths) {
        expect(path.d.startsWith('M')).toBe(true);
        expect(path.d).not.toContain('NaN');
        expect(path.opacity).toBeGreaterThan(0);
        // Faint: it sits behind the page title, never competes with it.
        expect(path.opacity).toBeLessThanOrEqual(0.8);
        expect(path.kind === 'stroke' ? path.strokeWidth > 0 : path.strokeWidth === 0).toBe(true);
      }
    }
  });

  test.each(IDS)('%s fades toward the left: the far third of the box is quieter than the near third', (id) => {
    // Every piece starts with an absolute moveto; its x and the path opacity say where the ink is.
    const weight = (from: number, to: number) => {
      let total = 0;
      for (const path of decorationPaths(id, DECORATION_WIDTH, DECORATION_HEIGHT)) {
        for (const start of path.d.matchAll(/M(-?\d+(?:\.\d+)?) /g)) {
          const x = Number(start[1]);
          if (x >= from && x < to) total += path.opacity;
        }
      }
      return total;
    };
    const third = DECORATION_WIDTH / 3;
    expect(weight(0, third)).toBeLessThan(weight(DECORATION_WIDTH - third, DECORATION_WIDTH + 20));
  });
});
