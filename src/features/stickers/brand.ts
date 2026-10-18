/**
 * JoyoFit's brand art for the engine's `brand` layers: the app icon's mark (an open step ring from 12 o'clock with a
 * trailing marker, `assets/brand/icon.svg`) redrawn as path items, the name and the link. Third-party marks (Strava,
 * Health Connect, Apple Health) are never drawn on a sticker: JoyoFit only uploads to Strava and shows none of its data,
 * and `docs/brand-marks.md` allows the other two only in the app UI.
 */
import type { BrandMarks, LogoItem } from './core/resolve';

const RING = 'M512 250A262 262 0 1 1 285.1 643';
/** A circle of radius 74 centered on (255.73, 457.53), as a path so every painter draws it the same way. */
const DOT = 'M255.73 383.53a74 74 0 1 0 0.01 0z';

function items(ring: string, dot: string): LogoItem[] {
  return [
    { d: RING, stroke: { color: ring, width: 120, cap: 'round' } },
    { d: DOT, fill: dot },
  ];
}

export const FIT_BRAND: BrandMarks = {
  name: 'JoyoFit', // i18n-ok: brand
  link: 'fit.joyorogo.com', // i18n-ok: URL
  logo(tone) {
    const viewBox: [number, number, number, number] = [0, 0, 1024, 1024];
    if (tone === 'light') return { viewBox, items: items('#f2f7f8', '#f5b35a') };
    if (tone === 'dark') return { viewBox, items: items('#0a6580', '#2ba3c4') };
    return { viewBox, items: items('$fg', '$fg') };
  },
};
