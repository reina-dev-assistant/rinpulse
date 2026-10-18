import type { MapPalette, MapTheme } from '@/features/map/palette';

/**
 * High-contrast basemap colours for the ride screen, read at arm's length in sunlight (day) or on an OLED at night.
 * Same keys as `MapPalette`, so `maplibreStyle(theme, ridePalette(theme))` draws the same layers. The ground is quiet and
 * low in saturation so a saturated route line stands out; roads carry a strong casing (day) or a bright fill on pure black
 * (night). Contrast is asserted in `ridePalette.test.ts`.
 */

const rideDay: MapPalette = {
  background: '#f1efe8',
  wood: '#c3dab3',
  grass: '#d8e6c8',
  park: '#cbe1ba',
  landuse: '#e6e2d7',
  water: '#9cc7e6',
  waterway: '#86b7dc',
  building: '#d9d4c7',
  aeroway: '#d6d1c4',
  roads: {
    motorway: '#f3b946',
    primary: '#f8d27a',
    secondary: '#ffffff',
    tertiary: '#ffffff',
    minor: '#ffffff',
    service: '#faf8f3',
    path: '#b8b0a0',
  },
  casing: '#58534a',
  rail: '#8a8578',
  boundary: '#8f84a8',
};

const rideNight: MapPalette = {
  background: '#000000',
  wood: '#0e1d12',
  grass: '#101e14',
  park: '#10201a',
  landuse: '#0f1013',
  water: '#0a2436',
  waterway: '#0e3050',
  building: '#1c1d22',
  aeroway: '#1f2025',
  roads: {
    motorway: '#c6923a',
    primary: '#a99f86',
    secondary: '#9a9aa2',
    tertiary: '#85868e',
    minor: '#73747c',
    service: '#5f6068',
    path: '#7d725c',
  },
  casing: '#000000',
  rail: '#55565e',
  boundary: '#7b8499',
};

export function ridePalette(theme: MapTheme): MapPalette {
  return theme === 'dark' ? rideNight : rideDay;
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
