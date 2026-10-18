import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { spacing, useColors } from '@/theme';

/** A route nobody answers to (a link to a screen this version does not have): say so and offer the way home. */
export default function NotFound() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <IconChip icon="compass-outline" size="lg" />
      <AppText variant="title" accessibilityRole="header" style={styles.centered}>
        {t('notFound.title')}
      </AppText>
      <AppText variant="caption" muted style={styles.centered}>
        {t('notFound.description')}
      </AppText>
      <Button label={t('notFound.home')} icon="home-outline" variant="primary" onPress={() => router.replace('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  centered: { textAlign: 'center' },
});
