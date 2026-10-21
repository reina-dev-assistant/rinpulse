import { ThemeProvider as NavigationThemeProvider, type Theme as NavigationThemeValue } from 'expo-router';
import { useMemo, type ReactNode } from 'react';

import { useTheme } from './ThemeProvider';

/**
 * Hands the app theme to the navigators. expo-router mounts its navigation container with React Navigation's stock light theme and
 * never reads ours, so everything a screen or a navigator draws from that theme itself (header tint, ripple, scene and card
 * backgrounds during a transition, the default title font, modal surfaces) stayed light-grey, iOS blue and system font in every
 * theme. Below this provider they get the palette and the font pair of the active theme.
 */
export function NavigationTheme({ children }: { children: ReactNode }) {
  const { colors, scheme, fonts } = useTheme();
  const value = useMemo<NavigationThemeValue>(
    () => ({
      dark: scheme === 'dark',
      colors: {
        primary: colors.primary,
        background: colors.background,
        card: colors.card,
        text: colors.foreground,
        border: colors.hairline,
        notification: colors.destructive,
      },
      fonts: {
        regular: { fontFamily: fonts.regular, fontWeight: '400' },
        medium: { fontFamily: fonts.medium, fontWeight: '400' },
        bold: { fontFamily: fonts.bold, fontWeight: '400' },
        heavy: { fontFamily: fonts.heavy, fontWeight: '400' },
      },
    }),
    [colors, scheme, fonts],
  );
  return <NavigationThemeProvider value={value}>{children}</NavigationThemeProvider>;
}
