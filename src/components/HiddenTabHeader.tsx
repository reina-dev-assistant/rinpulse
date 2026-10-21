import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { HIT, spacing, useTheme } from '@/theme';

/** Back arrow (or Today when there is no history) for a header that has none of its own. */
export function HeaderBackButton() {
  const router = useRouter();
  const { t } = useTranslation('common');
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('actions.back')}
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={styles.back}>
      <Ionicons name="arrow-back" size={24} color={colors.foreground} />
    </Pressable>
  );
}

/**
 * Header for a screen pushed from Today. These routes are hidden tabs, and a tab header has no back
 * button of its own, so this draws one (back, or Today when there is no history). `right` is an optional action at the far end.
 */
export function HiddenTabHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { colors, fonts } = useTheme();
  return (
    <Tabs.Screen
      options={{
        headerShown: true,
        title,
        headerLeft: () => <HeaderBackButton />,
        headerRight: right === undefined ? undefined : () => <View style={styles.right}>{right}</View>,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18, color: colors.foreground },
      }}
    />
  );
}

const styles = StyleSheet.create({
  back: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs },
  right: { marginRight: spacing.lg },
});
