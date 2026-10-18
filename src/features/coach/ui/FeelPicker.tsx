import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Segmented } from '@/components/Segmented';
import { spacing } from '@/theme';
import { FEELS, type Feel } from '../feel';

/**
 * "How does your body feel today?": the manual stand-in for the watch's readiness. Shown only while the watch gives no readiness; the
 * suggestion above it reacts as soon as an answer is picked.
 */
export function FeelPicker({ feel, onChange }: { feel: Feel | null; onChange: (feel: Feel) => void }) {
  const { t } = useTranslation('coach');
  return (
    <View style={styles.block} accessibilityLabel={t('feel.title')}>
      <AppText variant="label" muted>
        {t('feel.title')}
      </AppText>
      <Segmented options={FEELS.map((value) => ({ value, label: t(`feel.${value}`) }))} value={feel} onChange={onChange} />
      <AppText variant="caption" muted>
        {t('feel.hint')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xs, marginTop: spacing.sm },
});
