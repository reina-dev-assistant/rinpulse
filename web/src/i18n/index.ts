import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE, LOCALES, STORAGE_KEY, isLocale, resolveLocale, type Locale } from "./locale";
import { NAMESPACES, resources } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "app";
    resources: (typeof resources)["id"];
    returnNull: false;
  }
}

function storedChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The language the page opens in: the choice stored on this device (shared with JoyoFit Web), the browser's languages, `id`. */
export function initialLocale(): Locale {
  const device = typeof navigator === "undefined" ? [] : navigator.languages;
  return resolveLocale({ stored: storedChoice(), device });
}

export const i18n = i18next.createInstance();

i18n.use(initReactI18next);
void i18n.init({
  resources,
  lng: typeof window === "undefined" ? DEFAULT_LOCALE : initialLocale(),
  supportedLngs: [...LOCALES],
  fallbackLng: DEFAULT_LOCALE,
  ns: [...NAMESPACES],
  defaultNS: "app",
  // React escapes on its own; the few non-React callers (toasts, file names) take plain text.
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
  react: { useSuspense: false },
});

function apply(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}
apply(i18n.language as Locale);

/** Switches the language now and stores it as the device choice, so JoyoFit Web opens in the same one. */
export async function setLocale(locale: Locale): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Private mode: the language still switches for this visit.
  }
  apply(locale);
  await i18n.changeLanguage(locale);
}

// A language picked in another tab (Studio or JoyoFit Web) is followed here.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && isLocale(event.newValue) && event.newValue !== i18n.language) {
      apply(event.newValue);
      void i18n.changeLanguage(event.newValue);
    }
  });
}

/** The active locale as a BCP-47 tag for `Intl` and `toLocaleString`. */
export function intlLocale(): string {
  return i18n.language === "en" ? "en-US" : "id-ID";
}

export { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES, isLocale } from "./locale";
export type { Locale } from "./locale";
