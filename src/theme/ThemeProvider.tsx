import Storage from 'expo-sqlite/kv-store';
import * as SystemUI from 'expo-system-ui';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { notePrefChanged, subscribePrefApplied } from '@/cloud/prefsSync';

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
  setThemeId: (id: ThemeId) => void;
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
 * Holds the chosen theme. The choice is read synchronously from the kv store on first render, so
 * the first frame is already in the right theme, and written back on every change.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setId] = useState<ThemeId>(readStoredThemeId);
  // While a pinned theme is active React Native reports the pinned value, so remember what the
  // phone last said while a system theme was showing.
  const reported = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [system, setSystem] = useState<Scheme>(reported);
  const theme = getTheme(themeId);
  if (theme.appearance === 'system' && system !== reported) setSystem(reported);

  const scheme = resolveScheme(theme, system);
  const colors = theme.palettes[scheme];

  useEffect(() => {
    applyNativeScheme(theme);
  }, [theme]);

  useEffect(() => {
    // Root view color: shows behind the navigation bar and during overscroll and screen transitions.
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);

  const setThemeId = useCallback((id: ThemeId) => {
    const next = getTheme(id);
    // Before the render, so a switch back to a system theme reads the phone's scheme, not the pinned one.
    applyNativeScheme(next);
    setId(next.id);
    try {
      Storage.setItemSync(THEME_KEY, next.id);
    } catch {
      // The choice still applies for this session.
    }
    void notePrefChanged('theme');
  }, []);

  // A theme pulled from the account was just written to the kv store: show it without a restart.
  useEffect(
    () =>
      subscribePrefApplied('theme', () => {
        const next = getTheme(readStoredThemeId());
        applyNativeScheme(next);
        setId(next.id);
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
      setThemeId,
    }),
    [theme, scheme, system, colors, setThemeId],
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
