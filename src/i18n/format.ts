import { getLocale, t } from './core';
import type { Locale } from './locale';

// Intl-based formatting. Every helper reads the language the UI renders in; pass `locale` to pin one
// (tests, server-shaped payloads). Hermes ships Intl, so no native module is involved.

/** BCP-47 tag handed to Intl. Separators and date order follow the region. */
export const INTL_TAG: Record<Locale, string> = { id: 'id-ID', en: 'en-US' };

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numberFormat(locale: Locale, min: number, max: number): Intl.NumberFormat {
  const key = `n:${locale}:${min}:${max}`;
  let format = cache.get(key) as Intl.NumberFormat | undefined;
  if (!format) {
    format = new Intl.NumberFormat(INTL_TAG[locale], { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, format);
  }
  return format;
}

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d:${locale}:${JSON.stringify(options)}`;
  let format = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAG[locale], options);
    cache.set(key, format);
  }
  return format;
}

/** Number with the language's separators, up to `maxDecimals` (default 0) decimals. */
export function fmtNumber(n: number, maxDecimals = 0, locale: Locale = getLocale()): string {
  return numberFormat(locale, 0, maxDecimals).format(n);
}

/** Rounded to an integer: "1.234" (id) / "1,234" (en). */
export function fmtInt(n: number, locale: Locale = getLocale()): string {
  return numberFormat(locale, 0, 0).format(Math.round(n));
}

/** Exactly `decimals` decimals: "68,5" (id) / "68.5" (en). */
export function fmtDecimal(n: number, decimals = 1, locale: Locale = getLocale()): string {
  return numberFormat(locale, decimals, decimals).format(n);
}

/** Percent from a 0-100 value, no decimals: "42%". */
export function fmtPercent(n: number, locale: Locale = getLocale()): string {
  return `${fmtInt(n, locale)}%`;
}

export type DateStyle =
  /** "14 Sep" / "Sep 14" */
  | 'short'
  /** "14 Sep 2026" / "Sep 14, 2026" */
  | 'medium'
  /** "Minggu, 14 September 2026" / "Sunday, September 14, 2026" */
  | 'long'
  /** "Minggu, 14 Sep" / "Sunday, Sep 14" */
  | 'weekday'
  /** "September 2026" */
  | 'month'
  /** "Min" / "Sun" */
  | 'dayShort'
  /** "Minggu" / "Sunday" */
  | 'dayLong'
  /** "Okt" / "Oct" */
  | 'monthShort';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: 'numeric', month: 'short' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  weekday: { weekday: 'long', day: 'numeric', month: 'short' },
  month: { month: 'long', year: 'numeric' },
  dayShort: { weekday: 'short' },
  dayLong: { weekday: 'long' },
  monthShort: { month: 'short' },
};

/** A date in the phone's local time zone, from a Date or unix SECONDS. */
export function fmtDate(at: Date | number, style: DateStyle, locale: Locale = getLocale()): string {
  const date = typeof at === 'number' ? new Date(at * 1000) : at;
  return dateFormat(locale, DATE_OPTIONS[style]).format(date);
}

/** A 'YYYY-MM-DD' calendar day, formatted in UTC so it never shifts. */
export function fmtDay(day: string, style: DateStyle, locale: Locale = getLocale()): string {
  return dateFormat(locale, { ...DATE_OPTIONS[style], timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/** Wall-clock time in local time from a Date or unix SECONDS: "13.05" (id) / "1:05 PM" (en). */
export function fmtClock(at: Date | number, locale: Locale = getLocale()): string {
  const date = typeof at === 'number' ? new Date(at * 1000) : at;
  return dateFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** Date and time together, local: "14 Sep 2026 13.05" / "Sep 14, 2026, 1:05 PM". */
export function fmtDateTime(at: Date | number, locale: Locale = getLocale()): string {
  const date = typeof at === 'number' ? new Date(at * 1000) : at;
  return dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

/** "7 j 05 mnt" / "7 h 05 min", "42 mnt" / "42 min". Seconds in. */
export function fmtDuration(totalSec: number, locale: Locale = getLocale()): string {
  const minutes = Math.round(totalSec / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0
    ? t('common:duration.hm', { h: fmtInt(h, locale), m: String(m).padStart(2, '0'), lng: locale })
    : t('common:duration.m', { m: fmtInt(m, locale), lng: locale });
}

/** "12,34 km" / "12.34 km" past a kilometre, else "850 m". Metres in. */
export function fmtDistance(meters: number, locale: Locale = getLocale()): string {
  return meters >= 1000
    ? t('common:units.km', { value: fmtDecimal(meters / 1000, 2, locale), lng: locale })
    : t('common:units.m', { value: fmtInt(meters, locale), lng: locale });
}

/** "baru saja", "5 mnt lalu", "3 j lalu"; a day or older falls back to {@link fmtSyncTime}. Unix seconds. */
export function fmtAgo(sec: number, nowSec: number, locale: Locale = getLocale()): string {
  const ago = Math.max(0, nowSec - sec);
  if (ago < 60) return t('common:time.justNow', { lng: locale });
  if (ago < 3600) return t('common:time.minutesAgo', { count: Math.floor(ago / 60), lng: locale });
  if (ago < 86_400) return t('common:time.hoursAgo', { count: Math.floor(ago / 3600), lng: locale });
  return fmtSyncTime(sec, locale);
}

/** The clock for today, "12 Okt, 14.05" for any other day. Unix seconds, local time. */
export function fmtSyncTime(sec: number, locale: Locale = getLocale()): string {
  const d = new Date(sec * 1000);
  if (d.toDateString() === new Date().toDateString()) return fmtClock(d, locale);
  return `${fmtDate(d, 'short', locale)}, ${fmtClock(d, locale)}`;
}
