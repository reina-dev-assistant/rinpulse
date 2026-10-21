import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Details } from '@/components/Details';
import { PressableScale } from '@/components/PressableScale';
import { DecorationArt } from '@/components/ThemeDecoration';
import { Section } from '@/components/Screen';
import { spacing, THEMES, useTheme, type Colors, type Scheme, type Theme } from '@/theme';
import { loadAllThemeFonts } from '@/theme/fonts';

const DATA_TINTS = ['steps', 'heart', 'sleep', 'workouts', 'link'] as const;

/** How long the dialog stays busy after the restart was requested; a restart that happened has already replaced this screen. */
const RESTART_GRACE_MS = 5000;

/** Biggest sample numeral in the preview, in dp: Bebas Neue's 44 stays as it is, the 60+ of the others would not fit a half. */
const SAMPLE_MAX = 40;

/** The decoration's box in a preview, in dp: the full-size motif scaled to a corner of the miniature. */
const DECORATION_PREVIEW = { width: 120, height: 64 } as const;

/**
 * One palette of a theme as a miniature Today tile: the canvas, a card with a sample pace in the theme's numeral face and its
 * unit in the body face, the five data colors, and a primary button in the theme's control shape.
 */
function PreviewHalf({ theme, palette, scheme, fontsReady }: { theme: Theme; palette: Colors; scheme: Scheme; fontsReady: boolean }) {
  const { numeral, fonts } = theme.type;
  const size = Math.min(numeral.lg.size, SAMPLE_MAX);
  const lineHeight = Math.round(size * (numeral.lg.line / numeral.lg.size));
  const buttonRadius = Math.min(theme.radius.control, 6);
  return (
    <View style={[styles.half, { backgroundColor: palette.background }]}>
      {theme.decoration ? (
        <DecorationArt
          id={theme.decoration}
          colors={palette}
          scheme={scheme}
          width={DECORATION_PREVIEW.width}
          height={DECORATION_PREVIEW.height}
          style={styles.decoration}
        />
      ) : null}
      {/* The page header in miniature: a title bar and a caption bar, over the decoration like the real header. */}
      <View style={styles.header}>
        <View style={[styles.titleBar, { backgroundColor: palette.foreground }]} />
        <View style={[styles.captionBar, { backgroundColor: palette.mutedForeground }]} />
      </View>
      <View style={[styles.tile, { backgroundColor: palette.card, borderRadius: Math.min(theme.radius.tile, 14) }]}>
        {/* Mounted only once the fonts are registered, and keyed on it: Android measures a Text with the face it has at first layout and
            does not re-measure when the face arrives later, which cut '6:42' to '6:4' and left a gap before the unit. Until then a box of the
            same height keeps the tile from jumping. */}
        {fontsReady ? (
          <View key="sample" style={[styles.sampleRow, { height: lineHeight }]}>
            <Text
              allowFontScaling={false}
              style={{
                color: palette.foreground,
                fontFamily: fonts.numeral,
                fontSize: size,
                lineHeight,
                letterSpacing: numeral.lg.tracking * (size / numeral.lg.size),
                fontVariant: ['tabular-nums'],
              }}>
              6:42
            </Text>
            <Text
              allowFontScaling={false}
              style={{ color: palette.mutedForeground, fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 }}>
              /km
            </Text>
          </View>
        ) : (
          <View style={{ height: lineHeight }} />
        )}
        <View style={styles.dots}>
          {DATA_TINTS.map((tint) => (
            <View key={tint} style={[styles.dot, { backgroundColor: palette[tint] }]} />
          ))}
        </View>
      </View>
      <View style={[styles.button, { backgroundColor: palette.primary, borderRadius: buttonRadius }]} />
    </View>
  );
}

/**
 * The theme's look at a glance. A theme that follows the phone shows its light and dark palettes side by side, a pinned one its
 * single palette; the corner radius of the frame is the theme's card radius.
 */
function ThemePreview({ theme, fontsReady }: { theme: Theme; fontsReady: boolean }) {
  const { light, dark } = theme.palettes;
  const frame = Math.min(theme.radius.card, 18);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.preview, { borderRadius: frame, borderColor: theme.appearance === 'dark' ? dark.hairline : light.hairline }]}>
      {theme.appearance === 'dark' ? null : <PreviewHalf theme={theme} palette={light} scheme="light" fontsReady={fontsReady} />}
      {theme.appearance === 'light' ? null : <PreviewHalf theme={theme} palette={dark} scheme="dark" fontsReady={fontsReady} />}
    </View>
  );
}

/**
 * Theme picker: one card per theme with a preview in its own colors, shapes and fonts. Picking one asks first: a theme is applied by
 * saving it and restarting the app, so every screen, the navigators and the system bars start in it.
 */
export function AppearanceSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { theme: active, colors, applyThemeAndRestart } = useTheme();
  const [fontsReady, setFontsReady] = useState(false);
  const [pending, setPending] = useState<Theme | null>(null);
  const [restarting, setRestarting] = useState(false);

  // The previews draw in every theme's fonts; the launch only registered the active theme's.
  useEffect(() => {
    let live = true;
    loadAllThemeFonts()
      .catch(() => undefined)
      .then(() => {
        if (live) setFontsReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const confirm = async () => {
    if (!pending || restarting) return;
    setRestarting(true);
    await applyThemeAndRestart(pending.id);
    // Still here: no restart happened (updates disabled and no dev reload). The choice is saved and applies at the next start.
    setTimeout(() => {
      setRestarting(false);
      setPending(null);
    }, RESTART_GRACE_MS);
  };

  const name = pending ? t(`common:theme.${pending.id}.name`) : '';
  return (
    <Section title={t('appearance.title')} icon="color-palette">
      <View style={styles.list} accessibilityRole="radiogroup">
        {THEMES.map((theme) => {
          const selected = theme.id === active.id;
          return (
            <PressableScale
              key={theme.id}
              accessibilityRole="radio"
              accessibilityLabel={`${t(`common:theme.${theme.id}.name`)}. ${t(`common:theme.${theme.id}.tagline`)}`}
              accessibilityState={{ selected }}
              scaleTo={0.985}
              onPress={() => (selected ? undefined : setPending(theme))}
              style={[
                styles.row,
                {
                  backgroundColor: colors.muted,
                  borderColor: selected ? colors.primary : 'transparent',
                  borderRadius: active.radius.tile,
                },
              ]}>
              <ThemePreview theme={theme} fontsReady={fontsReady} />
              <View style={styles.caption}>
                <View style={styles.text}>
                  {fontsReady ? (
                    <Text
                      key="name"
                      numberOfLines={1}
                      style={{ color: colors.foreground, fontFamily: theme.type.fonts.headline, fontSize: 18, lineHeight: 24 }}>
                      {t(`common:theme.${theme.id}.name`)}
                    </Text>
                  ) : (
                    <View style={styles.namePlaceholder} />
                  )}
                  <AppText variant="caption" muted>
                    {t(`common:theme.${theme.id}.tagline`)}
                  </AppText>
                </View>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={selected ? colors.primary : colors.mutedForeground}
                />
              </View>
            </PressableScale>
          );
        })}
      </View>
      <Details title={t('appearance.aboutTitle')}>{t('appearance.details')}</Details>
      <ConfirmDialog
        visible={pending !== null}
        title={t('appearance.confirm.title', { name })}
        message={t('appearance.confirm.message')}
        confirmLabel={t('appearance.confirm.apply')}
        busy={restarting}
        onConfirm={() => void confirm()}
        onCancel={() => (restarting ? undefined : setPending(null))}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { padding: spacing.sm + 2, gap: spacing.sm + 2, borderWidth: 2 },
  preview: { flexDirection: 'row', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, height: 132 },
  half: { flex: 1, padding: spacing.sm, gap: spacing.sm, justifyContent: 'space-between' },
  decoration: { position: 'absolute', top: 0, right: 0 },
  header: { gap: 4, height: 20, justifyContent: 'center' },
  titleBar: { width: 38, height: 8, borderRadius: 4 },
  captionBar: { width: 56, height: 5, borderRadius: 2.5, opacity: 0.55 },
  tile: { flex: 1, paddingHorizontal: spacing.sm, paddingVertical: 6, justifyContent: 'space-between' },
  sampleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  namePlaceholder: { height: 24 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  button: { height: 10 },
  caption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 2 },
  text: { flex: 1, gap: 2 },
});
