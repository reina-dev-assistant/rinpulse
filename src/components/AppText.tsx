import { useMemo } from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';

import { fontSize, monoFont, useTheme } from '@/theme';

type Variant =
  | 'display'
  | 'figure'
  | 'title'
  | 'heading'
  | 'bodyStrong'
  | 'body'
  | 'caption'
  | 'label'
  | 'mono';

export interface AppTextProps extends TextProps {
  variant?: Variant;
  muted?: boolean;
  danger?: boolean;
  /** Overrides the color the other flags pick; used on tinted and hero surfaces. */
  color?: string;
}

export function AppText({ variant = 'body', muted, danger, color, style, ...rest }: AppTextProps) {
  const { colors, fonts, numeral, title } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        display: {
          fontFamily: fonts.numeral,
          fontSize: numeral.hero.size,
          lineHeight: numeral.hero.line,
          letterSpacing: numeral.hero.tracking,
          fontVariant: ['tabular-nums'],
        },
        figure: {
          fontFamily: fonts.numeral,
          fontSize: numeral.lg.size,
          lineHeight: numeral.lg.line,
          letterSpacing: numeral.lg.tracking,
          fontVariant: ['tabular-nums'],
        },
        title: { fontFamily: fonts.headline, fontSize: title.size, lineHeight: title.line, letterSpacing: title.tracking },
        heading: { fontFamily: fonts.bold, fontSize: fontSize.md, lineHeight: 22 },
        bodyStrong: { fontFamily: fonts.medium, fontSize: fontSize.base, lineHeight: 21 },
        body: { fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 22 },
        caption: { fontFamily: fonts.regular, fontSize: fontSize.sm, lineHeight: 19 },
        label: { fontFamily: fonts.medium, fontSize: fontSize.sm, lineHeight: 18 },
        mono: { fontFamily: monoFont, fontSize: fontSize.xs, lineHeight: 17 },
      }),
    [fonts, numeral, title],
  );
  const resolved =
    color ?? (danger ? colors.destructive : muted ? colors.mutedForeground : colors.foreground);
  return <Text {...rest} style={[styles[variant], { color: resolved }, style]} />;
}
