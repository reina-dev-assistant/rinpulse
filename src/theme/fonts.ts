import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { loadAsync, type FontSource } from 'expo-font';

import { THEMES, themeFontFamilies, type FontFamilyName, type Theme } from './themes';

/**
 * Every font a theme can draw with, registered at runtime by `expo-font` (`useFonts` in the root layout, `loadAsync` for the
 * picker's previews), never by the config plugin: a font is JS and assets, so a theme with a new face still ships over the air.
 *
 * Plus Jakarta Sans comes from its Expo Google Fonts package. The rest are the static weights the themes use, copied to
 * `assets/fonts` from the same Expo Google Fonts packages (SIL Open Font License 1.1; the licenses are in `assets/fonts/licenses`),
 * only the weights that a theme names. Android has no weight axis, so each weight is its own family.
 */
const FONT_ASSETS: Record<FontFamilyName, FontSource> = {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  Manrope_500Medium: require('../../assets/fonts/Manrope_500Medium.ttf'),
  Manrope_600SemiBold: require('../../assets/fonts/Manrope_600SemiBold.ttf'),
  Manrope_700Bold: require('../../assets/fonts/Manrope_700Bold.ttf'),
  Manrope_800ExtraBold: require('../../assets/fonts/Manrope_800ExtraBold.ttf'),
  Nunito_500Medium: require('../../assets/fonts/Nunito_500Medium.ttf'),
  Nunito_600SemiBold: require('../../assets/fonts/Nunito_600SemiBold.ttf'),
  Nunito_700Bold: require('../../assets/fonts/Nunito_700Bold.ttf'),
  Nunito_800ExtraBold: require('../../assets/fonts/Nunito_800ExtraBold.ttf'),
  Archivo_500Medium: require('../../assets/fonts/Archivo_500Medium.ttf'),
  Archivo_600SemiBold: require('../../assets/fonts/Archivo_600SemiBold.ttf'),
  Archivo_700Bold: require('../../assets/fonts/Archivo_700Bold.ttf'),
  Archivo_800ExtraBold: require('../../assets/fonts/Archivo_800ExtraBold.ttf'),
  Archivo_900Black: require('../../assets/fonts/Archivo_900Black.ttf'),
  BebasNeue_400Regular: require('../../assets/fonts/BebasNeue_400Regular.ttf'),
  SpaceGrotesk_500Medium: require('../../assets/fonts/SpaceGrotesk_500Medium.ttf'),
  SpaceGrotesk_600SemiBold: require('../../assets/fonts/SpaceGrotesk_600SemiBold.ttf'),
  SpaceGrotesk_700Bold: require('../../assets/fonts/SpaceGrotesk_700Bold.ttf'),
  JetBrainsMono_800ExtraBold: require('../../assets/fonts/JetBrainsMono_800ExtraBold.ttf'),
  Fraunces_800ExtraBold: require('../../assets/fonts/Fraunces_800ExtraBold.ttf'),
  Quicksand_500Medium: require('../../assets/fonts/Quicksand_500Medium.ttf'),
  Quicksand_600SemiBold: require('../../assets/fonts/Quicksand_600SemiBold.ttf'),
  Quicksand_700Bold: require('../../assets/fonts/Quicksand_700Bold.ttf'),
  DMSerifDisplay_400Regular: require('../../assets/fonts/DMSerifDisplay_400Regular.ttf'),
  Doto_900Black: require('../../assets/fonts/Doto_900Black.ttf'),
};

/** The `useFonts` / `loadAsync` map of one theme: only its own families, so a launch registers 4 to 6 files, not all of them. */
export function themeFontMap(theme: Theme): Record<string, FontSource> {
  return Object.fromEntries(themeFontFamilies(theme).map((family) => [family, FONT_ASSETS[family]]));
}

const ALL_FAMILIES = [...new Set(THEMES.flatMap(themeFontFamilies))];

const requested = new Map<string, Promise<void>>();

function load(families: readonly FontFamilyName[]): Promise<void> {
  const missing = families.filter((family) => !requested.has(family));
  if (missing.length > 0) {
    const batch = loadAsync(Object.fromEntries(missing.map((family) => [family, FONT_ASSETS[family]])));
    for (const family of missing) requested.set(family, batch);
    // A failed batch is retried by the next call instead of staying failed for the session.
    batch.catch(() => {
      for (const family of missing) requested.delete(family);
    });
  }
  return Promise.all(families.map((family) => requested.get(family))).then(() => undefined);
}

/** Registers a theme's fonts (a theme pulled from the account, applied without a restart). Resolves when they can draw. */
export function loadThemeFonts(theme: Theme): Promise<void> {
  return load(themeFontFamilies(theme));
}

/** Registers every theme's fonts, for the picker: each preview numeral is drawn in its own theme's face. */
export function loadAllThemeFonts(): Promise<void> {
  return load(ALL_FAMILIES);
}
