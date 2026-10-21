import { Ionicons } from '@expo/vector-icons';
import type { ReactNode, RefObject } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { useTabBarInset } from '@/components/tabBarInset';
import { useKeyboardOverlap } from '@/components/useKeyboardOverlap';
import { spacing, useColors, useTheme, type Tint } from '@/theme';

export interface RefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  /** False greys the gesture out, e.g. while there is no watch to read from. */
  enabled?: boolean;
}

/**
 * Padding for a screen's scrolling content. Tab-root screens draw their own title and sit under the
 * status bar (`withTitle`); stack screens have a native header that already clears it.
 */
export function useContentPadding(withTitle: boolean, clearTabBar = true): ViewStyle {
  const insets = useSafeAreaInsets();
  // The tab bar floats over the scene: the end of the content clears it so the last item scrolls fully above it.
  const tabBar = useTabBarInset();
  return {
    paddingTop: (withTitle ? insets.top : 0) + spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl + (clearTabBar ? tabBar : 0),
  };
}

/** Pull-to-refresh control in the app colors. */
export function useRefreshControl(refresh: RefreshProps | undefined) {
  const colors = useColors();
  if (!refresh) return undefined;
  return (
    <RefreshControl
      refreshing={refresh.refreshing}
      onRefresh={refresh.onRefresh}
      enabled={refresh.enabled ?? true}
      colors={[colors.primary]}
      tintColor={colors.primary}
      progressBackgroundColor={colors.card}
    />
  );
}

interface PageHeaderProps {
  title: string;
  caption?: string;
  right?: ReactNode;
}

/** 28 px page title for tab-root screens, with an optional caption and one right-hand action. */
export function PageHeader({ title, caption, right }: PageHeaderProps) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {caption ? (
          <AppText variant="caption" muted>
            {caption}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

interface ScreenProps {
  /** Draws the big page title; leave out on stack screens that have a native header. */
  title?: string;
  caption?: string;
  right?: ReactNode;
  refresh?: RefreshProps;
  /** False freezes the scroll, e.g. while a chart is being scrubbed. */
  scrollEnabled?: boolean;
  /** The scroll view, for `scrollTo`. */
  scrollRef?: RefObject<ScrollView | null>;
  /** A bar pinned under the scrolling content, lifted above the keyboard (a comment composer). */
  footer?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, caption, right, refresh, scrollEnabled = true, scrollRef, footer, children }: ScreenProps) {
  const colors = useColors();
  // With a footer the footer sits above the bar, so the content above it does not clear the bar again.
  const padding = useContentPadding(title !== undefined, footer === undefined);
  const refreshControl = useRefreshControl(refresh);
  const keyboard = useKeyboardOverlap();
  const tabBar = useTabBarInset();
  const scroll = (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, padding]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      scrollEnabled={scrollEnabled}
      showsVerticalScrollIndicator={false}>
      {title ? <PageHeader title={title} caption={caption} right={right} /> : null}
      {children}
    </ScrollView>
  );
  if (!footer) return scroll;
  return (
    <View ref={keyboard.ref} collapsable={false} style={[styles.fill, { backgroundColor: colors.background, paddingBottom: Math.max(keyboard.lift, tabBar) }]}>
      {scroll}
      {footer}
    </View>
  );
}

/** Borderless white card, themed radius, padding 16. Sits flat: no border, no shadow. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, radius } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.card }, style]}>{children}</View>;
}

interface SectionProps {
  title: string;
  icon?: IconName;
  tint?: Tint | 'neutral';
  /** Replaces the icon chip, e.g. a `BrandMark`. */
  leading?: ReactNode;
  /** Right of the title, e.g. a count. */
  trailing?: ReactNode;
  /** Makes the whole card a button that opens more detail; the header gets a chevron. */
  onPress?: () => void;
  children: ReactNode;
}

/** A titled card. The title row carries an icon chip so every section is findable at a glance. */
export function Section({ title, icon, tint = 'neutral', leading, trailing, onPress, children }: SectionProps) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader} accessibilityRole="header">
        {leading ?? (icon ? <IconChip icon={icon} tint={tint} size="sm" /> : null)}
        <AppText variant="heading" style={styles.sectionTitle}>
          {title}
        </AppText>
        {trailing}
        {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} /> : null}
      </View>
      {onPress ? (
        <PressableScale accessibilityRole="button" accessibilityLabel={title} onPress={onPress} scaleTo={0.985}>
          <Card>{children}</Card>
        </PressableScale>
      ) : (
        <Card>{children}</Card>
      )}
    </View>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={[styles.divider, { backgroundColor: colors.hairline }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.lg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40 },
  pageHeaderText: { flex: 1, gap: 2 },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  sectionTitle: { flex: 1 },
  card: { padding: spacing.md + 4, gap: spacing.sm + 2 },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});
