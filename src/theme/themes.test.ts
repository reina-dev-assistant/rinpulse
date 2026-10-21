import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_THEME_ID,
  FONT_FAMILY_NAMES,
  getTheme,
  parseThemeId,
  resolveScheme,
  THEMES,
  themeFontFamilies,
  type Colors,
  type Tint,
} from './themes';

/** WCAG relative luminance of a `#RRGGBB` color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TINTS: readonly Tint[] = ['steps', 'heart', 'sleep', 'workouts', 'link'];

const palettes = THEMES.flatMap((theme) =>
  (['light', 'dark'] as const).map((scheme) => ({ label: `${theme.id} ${scheme}`, colors: theme.palettes[scheme] })),
);

describe.each(palettes)('contrast: $label', ({ colors }) => {
  test('every *Text passes AA on its soft tint and on card', () => {
    for (const tint of TINTS) {
      expect(contrast(colors[`${tint}Text`], colors[`${tint}Soft`])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors[`${tint}Text`], colors.card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('base data colors are visible on card and on their soft tint', () => {
    for (const tint of TINTS) {
      expect(contrast(colors[tint], colors.card)).toBeGreaterThanOrEqual(3);
      expect(contrast(colors[tint], colors[`${tint}Soft`])).toBeGreaterThanOrEqual(3);
    }
  });

  test('body and muted text', () => {
    for (const surface of [colors.background, colors.card, colors.muted]) {
      expect(contrast(colors.foreground, surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.mutedForeground, surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(colors.primaryForeground, colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.destructive, colors.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.destructive, colors.destructiveSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.primary, colors.card)).toBeGreaterThanOrEqual(3);
  });

  test('hero panel text and accents', () => {
    // A gradient panel runs from `hero` to `heroEnd`: the text has to hold on both ends.
    for (const end of [colors.hero, colors.heroEnd]) {
      expect(contrast(colors.heroForeground, end)).toBeGreaterThanOrEqual(7);
      for (const key of ['heroMuted', 'heroSteps', 'heroHeart', 'heroLink', 'heroWarn', 'heroAccent'] as const) {
        expect(contrast(colors[key], end)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(colors.heroTrack, end)).toBeGreaterThanOrEqual(1.3);
    }
  });

  test('sleep stage bars are visible on card', () => {
    for (const stage of [colors.stageDeep, colors.stageRem, colors.stageLight, colors.stageAwake]) {
      expect(contrast(stage, colors.card)).toBeGreaterThanOrEqual(1.5);
    }
  });

  test('switch off track is visible on card', () => {
    expect(contrast(colors.switchOff, colors.card)).toBeGreaterThanOrEqual(1.4);
  });
});

describe('themes', () => {
  test('ids are unique and every theme defines every token in both palettes', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    const keys = Object.keys(getTheme(DEFAULT_THEME_ID).palettes.light).sort();
    for (const theme of THEMES) {
      for (const scheme of ['light', 'dark'] as const) {
        const colors: Colors = theme.palettes[scheme];
        expect(Object.keys(colors).sort()).toEqual(keys);
      }
    }
  });

  test('classic is the default and unknown stored ids fall back to it', () => {
    expect(DEFAULT_THEME_ID).toBe('classic');
    expect(parseThemeId('sport')).toBe('sport');
    expect(parseThemeId('sunset')).toBe('sunset');
    expect(parseThemeId('vaporwave')).toBe('classic');
    expect(parseThemeId(null)).toBe('classic');
  });

  test('pinned themes ignore the phone scheme, system themes follow it', () => {
    expect(resolveScheme(getTheme('sport'), 'light')).toBe('dark');
    expect(resolveScheme(getTheme('classic'), 'light')).toBe('light');
    expect(resolveScheme(getTheme('classic'), 'dark')).toBe('dark');
    expect(resolveScheme(getTheme('ocean'), 'dark')).toBe('dark');
  });

  test('sport is tighter and heavier than classic', () => {
    const classic = getTheme('classic');
    const sport = getTheme('sport');
    expect(sport.radius.card).toBeLessThan(classic.radius.card);
    expect(sport.type.numeral.hero.size).toBeGreaterThan(classic.type.numeral.hero.size);
    expect(sport.type.fonts.regular).not.toBe(classic.type.fonts.regular);
  });

  test('dark themes pin dark, the pastel and cream ones pin light, the rest follow the phone', () => {
    for (const id of ['sport', 'amoled', 'neon', 'sunset', 'rosegold'] as const) expect(getTheme(id).appearance).toBe('dark');
    for (const id of ['retro', 'peach', 'strawberry', 'matcha'] as const) expect(getTheme(id).appearance).toBe('light');
    for (const id of ['classic', 'ocean', 'sogan', 'forest', 'soft', 'mono', 'sakura', 'lavender'] as const) {
      expect(getTheme(id).appearance).toBe('system');
    }
  });

  test('amoled is pure black', () => {
    expect(getTheme('amoled').palettes.dark.background).toBe('#000000');
  });

  test('only a pinned light/dark theme repeats its palette, a system theme has two different ones', () => {
    for (const theme of THEMES) {
      const same = theme.palettes.light === theme.palettes.dark;
      expect(same).toBe(theme.appearance !== 'system');
    }
  });

  test('every theme has a distinct look: no two share a primary on the same surface', () => {
    const seen = new Set<string>();
    for (const theme of THEMES) {
      const p = theme.palettes[theme.appearance === 'dark' ? 'dark' : 'light'];
      const key = `${p.background}/${p.primary}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('radii are not negative and shrink from card to tile to input', () => {
    for (const theme of THEMES) {
      const r = theme.radius;
      for (const value of [r.card, r.tile, r.input, r.control, r.bar]) expect(value).toBeGreaterThanOrEqual(0);
      expect(r.card).toBeGreaterThanOrEqual(r.tile);
      expect(r.tile).toBeGreaterThanOrEqual(r.input);
    }
  });
});

describe('fonts', () => {
  test('every role of every theme is a registered family', () => {
    for (const theme of THEMES) {
      for (const family of Object.values(theme.type.fonts)) expect(FONT_FAMILY_NAMES).toContain(family);
    }
  });

  test('themeFontFamilies lists each family once', () => {
    for (const theme of THEMES) {
      const families = themeFontFamilies(theme);
      expect(new Set(families).size).toBe(families.length);
      expect(families).toContain(theme.type.fonts.numeral);
      expect(families).toContain(theme.type.fonts.headline);
    }
  });

  test('every bundled family is used by some theme (no dead font file)', () => {
    const used = new Set(THEMES.flatMap(themeFontFamilies));
    for (const family of FONT_FAMILY_NAMES) expect(used.has(family)).toBe(true);
  });

  test('numerals only use faces with tabular figures', () => {
    // Fraunces and Oswald have none; digits would jitter in a live timer.
    const tabular = new Set([
      'PlusJakartaSans_800ExtraBold',
      'Manrope_800ExtraBold',
      'Nunito_800ExtraBold',
      'Archivo_800ExtraBold',
      'Archivo_900Black',
      'BebasNeue_400Regular',
      'SpaceGrotesk_700Bold',
      'JetBrainsMono_800ExtraBold',
    ]);
    for (const theme of THEMES) expect(tabular.has(theme.type.fonts.numeral)).toBe(true);
  });

  test('numeral scale shrinks from hero to sm with line height at least the size', () => {
    for (const theme of THEMES) {
      const { hero, lg, md, sm } = theme.type.numeral;
      expect(hero.size).toBeGreaterThan(lg.size);
      expect(lg.size).toBeGreaterThan(md.size);
      expect(md.size).toBeGreaterThan(sm.size);
      for (const n of [hero, lg, md, sm]) expect(n.line).toBeGreaterThanOrEqual(n.size);
    }
  });
});
