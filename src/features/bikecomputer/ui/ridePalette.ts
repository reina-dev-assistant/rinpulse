/**
 * Colours of the ride screen. A pair of its own (day = white, night = black) instead of a fourth app theme: the ride screen must not change
 * when the person's theme does, and every pair is checked for contrast in `ridePalette.test.ts`. Pure: no React Native.
 *
 * Rules: numerals are the foreground colour (>= 7:1), labels the muted one (>= 4.5:1), zone and data colours >= 3:1 on the background,
 * one accent (route line, active page dot, climb marker), no translucency, no gradients.
 */
import type { FieldTone, RideThemeSetting } from '../types';

export type RideTheme = 'day' | 'night';

export interface RidePalette {
  theme: RideTheme;
  background: string;
  /** Numerals and primary text. */
  foreground: string;
  /** Labels and units. */
  muted: string;
  /** Separators between cells; structure only, not text. */
  hairline: string;
  /** A second surface for banners and secondary controls. */
  surface: string;
  /** The one accent: route line, active page dot, climb marker. */
  accent: string;
  /** Zones 1..7, index 0 = zone 1. */
  zones: readonly [string, string, string, string, string, string, string];
  warn: string;
  /** Off-course banner fill and the text on it; also the recording dot. */
  offCourse: string;
  onOffCourse: string;
  /** Urgent alert banner: the highest contrast pair the screen has. */
  urgent: string;
  onUrgent: string;
}

const DAY: RidePalette = {
  theme: 'day',
  background: '#FFFFFF',
  foreground: '#000000',
  muted: '#4A4A4A',
  hairline: '#B5B5B5',
  surface: '#EDEDED',
  accent: '#0B57D0',
  zones: ['#6B7280', '#0072B2', '#1E8E3E', '#8A6D00', '#C2410C', '#C2185B', '#7B1FA2'],
  warn: '#A64B00',
  offCourse: '#B00020',
  onOffCourse: '#FFFFFF',
  urgent: '#000000',
  onUrgent: '#FFFFFF',
};

const NIGHT: RidePalette = {
  theme: 'night',
  background: '#000000',
  foreground: '#FFFFFF',
  muted: '#B8B8B8',
  hairline: '#4A4A4A',
  surface: '#1A1A1A',
  accent: '#5FA8FF',
  zones: ['#9CA3AF', '#4DB3FF', '#4ADE80', '#FACC15', '#FB923C', '#FF5C8A', '#C084FC'],
  warn: '#FFB020',
  offCourse: '#FF7A70',
  onOffCourse: '#000000',
  urgent: '#FFFFFF',
  onUrgent: '#000000',
};

export const RIDE_PALETTES: Record<RideTheme, RidePalette> = { day: DAY, night: NIGHT };

/** `auto` follows the app's light/dark; `day` and `night` pin it. */
export function resolveRideTheme(setting: RideThemeSetting, appScheme: 'light' | 'dark'): RideTheme {
  if (setting === 'day') return 'day';
  if (setting === 'night') return 'night';
  return appScheme === 'dark' ? 'night' : 'day';
}

export function ridePalette(theme: RideTheme): RidePalette {
  return RIDE_PALETTES[theme];
}

/** The colour a field value is drawn in for its tone. */
export function toneColor(palette: RidePalette, tone: FieldTone): string {
  if (tone === 'neutral') return palette.foreground;
  if (tone === 'warn') return palette.warn;
  const index = Number(tone.slice(4)) - 1;
  return palette.zones[index] ?? palette.foreground;
}

/** WCAG relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#RRGGBB` colours, 1..21. */
export function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
