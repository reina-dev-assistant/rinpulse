import Storage from 'expo-sqlite/kv-store';
import * as SystemUI from 'expo-system-ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { notePrefChanged, subscribePrefApplied } from '@/cloud/prefsSync';

import { loadThemeFonts } from './fonts';
import { restartApp } from './restart';
import { DEFAULT_THEME_ID, getTheme, parseThemeId, resolveScheme, type Colors, type Scheme, type Theme, type ThemeId } from './themes';

/** The kv-store key of the choice; also the synced preference `theme` (`src/cloud/syncInventory.ts`). */
export const THEME_KEY = 'app_theme';

interface ThemeContextValue {
  theme: Theme;
  /** Light or dark as drawn: pinned by the theme, or the phone's setting. */
  scheme: Scheme;
  /** What the phone itself is set to; the light/dark a system-following theme would use. */
  systemScheme: Scheme;
  colors: Colors;
  radius: Theme['radius'];
  fonts: Theme['type']['fonts'];
  numeral: Theme['type']['numeral'];
  title: Theme['type']['title'];
  /**
   * Saves the choice and restarts the app in it. A theme is not swapped live: the navigators, the native bars and every
   * `StyleSheet` made from the old theme would each have to be told, and one that is missed keeps the old colors. A restart
   * starts everything from the saved theme, which `ThemeProvider` reads synchronously, so the first frame is already right.
   */
  applyThemeAndRestart: (id: ThemeId) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Pins the whole app (status bar, navigation bar, native dialogs and pickers) to the theme's
 * light/dark, or hands it back to the phone. `unspecified` makes React Native re-read the system value.
 */
function applyNativeScheme(theme: Theme): void {
  Appearance.setColorScheme(theme.appearance === 'system' ? 'unspecified' : theme.appearance);
}

function readStoredThemeId(): ThemeId {
  try {
    return parseThemeId(Storage.getItemSync(THEME_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}

/**
 * Holds the chosen theme. The choice is read synchronously from the kv store before the first render, and the phone's scheme is
 * pinned (or released) to match in the same step, so the first frame is already in the right theme and the system bars and
 * dialogs agree with it. A change is saved and the app restarts (`applyThemeAndRestart`).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setId] = useState<ThemeId>(() => {
    const id = readStoredThemeId();
    // Before `useColorScheme` below reads the scheme: a pinned scheme left over from the theme before a restart must not
    // be reported as the phone's. Setting the same value again is harmless, so a double render does not matter.
    applyNativeScheme(getTheme(id));
    return id;
  });
  // While a pinned theme is active React Native reports the pinned value, so remember what the
  // phone last said while a system theme was showing.
  const reported = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [system, setSystem] = useState<Scheme>(reported);
  const theme = getTheme(themeId);
  if (theme.appearance === 'system' && system !== reported) setSystem(reported);

  const scheme = resolveScheme(theme, system);
  const colors = theme.palettes[scheme];

  useEffect(() => {
    // Root view color: shows behind the navigation bar and during overscroll and screen transitions.
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);

  const applyThemeAndRestart = useCallback(async (id: ThemeId) => {
    const next = getTheme(id);
    // Released or pinned now, so the restarted app's first `useColorScheme` already reports the phone's scheme (leaving a
    // pinned theme) instead of the old theme's.
    applyNativeScheme(next);
    try {
      Storage.setItemSync(THEME_KEY, next.id);
    } catch {
      // Not saved: the restart comes back in the old theme and the picker shows it.
    }
    // The edit is stamped in the sync table before the JS context goes away.
    await notePrefChanged('theme');
    await restartApp();
  }, []);

  // A theme pulled from the account was just written to the kv store. Not an interruption to restart for: it is shown live,
  // once its fonts are registered, and the next launch starts clean in it.
  useEffect(
    () =>
      subscribePrefApplied('theme', () => {
        const next = getTheme(readStoredThemeId());
        void loadThemeFonts(next)
          .catch(() => undefined)
          .then(() => {
            applyNativeScheme(next);
            setId(next.id);
          });
      }),
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      scheme,
      systemScheme: system,
      colors,
      radius: theme.radius,
      fonts: theme.type.fonts,
      numeral: theme.type.numeral,
      title: theme.type.title,
      applyThemeAndRestart,
    }),
    [theme, scheme, system, colors, applyThemeAndRestart],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme needs a ThemeProvider above it (see the root layout).');
  return value;
}

export function useColors(): Colors {
  return useTheme().colors;
}
