import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useTheme } from '@/theme';

/** Who answers right now ("claude-haiku-5.5, kunci sendiri" or "JoyoRogo Pro 3/20"); tapping it opens the Joyo AI settings. */
export function EngineChip({ label }: { label: string }) {
  const { t } = useTranslation('ai');
  const { colors, radius } = useTheme();
  const router = useRouter();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('chip.open', { engine: label })}
      onPress={() => router.push('/settings/ai')}
      scaleTo={0.97}
      style={[styles.chip, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
      <Ionicons name="chatbubbles" size={16} color={colors.mutedForeground} />
      <AppText variant="label" numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
      <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 44, alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  label: { flexShrink: 1 },
});
