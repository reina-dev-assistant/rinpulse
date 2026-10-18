/**
 * Colours of the replay: the sticker engine's own palette tokens (INK for the light card, VOLT for the dark one, so a replay
 * and a sticker of the same workout look related), one sport colour per activity type, and the basemap palette of the
 * in-app map with its background pulled onto the card background so tile edges never show.
 */
import { darkPalette, lightPalette, type MapPalette } from '@/features/map/palette';
import { INK, VOLT } from '@/features/stickers/templates/palette';

import type { ReplayKind } from './track';

export type ReplayMode = 'dark' | 'light';

export interface ReplayTheme {
  mode: ReplayMode;
  bg: string;
  /** Top of the fade between the map and the card. */
  bg2: string;
  fg: string;
  fgSoft: string;
  fgMuted: string;
  surface: string;
  surfaceStrong: string;
  line: string;
  /** The sport colour: the drawn route, the cursor and the chart line. */
  accent: string;
  /** The route not yet drawn. */
  ghost: string;
  hr: string;
  speed: string;
  height: string;
  record: string;
  map: MapPalette;
  /** Terrain silhouette layers, far to near. */
  ridges: readonly [string, string, string];
}

const SPORT_DARK: Record<ReplayKind, string> = {
  ride: VOLT.dark.accent2,
  run: VOLT.dark.bad,
  walk: INK.dark.accent2,
  swim: INK.dark.accent2,
  other: INK.dark.accent,
};

const SPORT_LIGHT: Record<ReplayKind, string> = {
  ride: INK.light.accent,
  run: VOLT.light.bad,
  walk: INK.light.accent2,
  swim: INK.light.accent2,
  other: INK.light.accent,
};

export function themeFor(mode: ReplayMode, kind: ReplayKind): ReplayTheme {
  if (mode === 'dark') {
    const c = VOLT.dark;
    return {
      mode,
      bg: c.bg,
      bg2: '#16171a',
      fg: c.fg,
      fgSoft: c.fgSoft,
      fgMuted: c.fgMuted,
      surface: '#1b1c20f2',
      surfaceStrong: '#26282d',
      line: c.line,
      accent: SPORT_DARK[kind],
      ghost: '#ffffff1f',
      hr: INK.dark.bad,
      speed: INK.dark.good,
      height: INK.dark.accent2,
      record: INK.dark.accent,
      // Land fills sit just above the card colour so tile seams never show; the roads carry the picture.
      map: { ...darkPalette, background: c.bg, wood: '#0f1310', grass: '#0f1310', park: '#101510', landuse: '#0e0e10', building: '#17181b', water: '#090b0f', waterway: '#10151c' },
      ridges: ['#141518', '#1a1b1f', '#212328'],
    };
  }
  const c = INK.light;
  return {
    mode,
    bg: c.bg,
    bg2: c.bg2,
    fg: c.fg,
    fgSoft: c.fgSoft,
    fgMuted: c.fgMuted,
    surface: '#fffffff2',
    surfaceStrong: '#efe8dc',
    line: c.line,
    accent: SPORT_LIGHT[kind],
    ghost: '#0f2f3a26',
    hr: c.bad,
    speed: c.good,
    height: c.accent2,
    record: c.accent,
    map: { ...lightPalette, background: c.bg },
    ridges: ['#e6dfd1', '#ddd5c4', '#d2c9b6'],
  };
}
