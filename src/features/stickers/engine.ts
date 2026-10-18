/**
 * Host glue around the shared engine: the translate function, the font map and the brand, and `sceneFor`, the one call
 * every screen and test makes: parsed template + subject data + options -> Scene.
 */
import { i18n, type Locale } from '@/i18n';

import { FIT_BRAND } from './brand';
import { resolve, type ImageRef, type StickerData, type StickerOptions } from './core/resolve';
import type { Scene } from './core/scene';
import type { Template } from './core/schema';
import type { FontMap } from './core/text';
import { FIT_FONTS } from './fonts';
import type { JsonObject } from './subject';

export type Mode = 'dark' | 'light';

export interface RenderOptions {
  locale: Locale;
  mode: Mode;
  /** `watermark`, `hideNumbers`, `showName` and the route trim (200 m unless the person switched privacy off). */
  options?: StickerData['options'];
  /** The subject's date (epoch ms), bound as `{date}`. */
  date?: number;
  /** `photo` and `mapImage` by name. */
  assets?: Record<string, ImageRef | undefined>;
  /** Golden renders swap in a font map whose `paint` returns installed family names. */
  fonts?: FontMap;
}

/** Defaults a sticker starts with; the sheet only changes them on the person's say-so. */
export const DEFAULT_STICKER_OPTIONS: StickerOptions = {
  watermark: true,
  hideNumbers: false,
  showName: false,
  privacy: { routeTrimMeters: 200 },
};

/** Template + subject data -> Scene. Total: it never throws; problems come back as `scene.issues`. */
export function sceneFor(template: Template, data: JsonObject, opts: RenderOptions): Scene {
  const t = i18n.getFixedT(opts.locale);
  const input: StickerData = { data, date: opts.date, assets: opts.assets, options: opts.options };
  return resolve(template, input, {
    locale: opts.locale,
    mode: opts.mode,
    t: (key, args) => String(t(key as never, args as never)),
    fonts: opts.fonts ?? FIT_FONTS,
    brand: FIT_BRAND,
  });
}
