/** Languages Studio ships; the same two JoyoFit Web ships (`@joyorogo/i18n`), with the same source language. */
export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "id";

/** Language names in their own language, never translated, so a lost user can find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = { id: "Bahasa Indonesia", en: "English" };

/** JoyoFit Web keeps the device's explicit choice here (apps/fit `src/lib/i18n.ts`); Studio shares the origin, so one pick serves both. */
export const STORAGE_KEY = "jfit-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** "en-US", "id-ID" and legacy Android "in" to a shipped locale, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const language = tag.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  if (language === "in") return "id";
  return isLocale(language) ? language : null;
}

/** Stored device choice, then the browser's languages in order, then `id`. */
export function resolveLocale({ stored, device }: { stored?: string | null; device?: readonly string[] | null }): Locale {
  if (isLocale(stored)) return stored;
  for (const tag of device ?? []) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
