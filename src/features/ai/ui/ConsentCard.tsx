import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider } from '@/components/Screen';
import { spacing } from '@/theme';
import { CONSENT_CATEGORIES } from '../consent';

interface ConsentCardProps {
  provider: string;
  host: string;
  onSample: () => void;
}

/**
 * What the person agrees to before the key is saved (Apple 5.1.2(i), Google Play's AI user-data rules): who gets the data, every kind
 * of data that leaves the phone, what never does, and that the provider's own terms apply. The categories are `CONSENT_CATEGORIES`,
 * so a change to the digest (and its `CONSENT_VERSION`) shows up here.
 */
export function ConsentCard({ provider, host, onSample }: ConsentCardProps) {
  const { t } = useTranslation('ai');
  return (
    <View style={styles.wrap}>
      <AppText variant="bodyStrong">{t('consent.to', { provider, host })}</AppText>
      <AppText variant="caption" muted>
        {t('consent.lead')}
      </AppText>
      <View style={styles.list}>
        {CONSENT_CATEGORIES.map((id) => (
          <AppText key={id} variant="caption">
            {`\u2022 ${t(`consent.data.${id}`)}`}
          </AppText>
        ))}
      </View>
      <Divider />
      <AppText variant="bodyStrong">{t('consent.notSentTitle')}</AppText>
      <AppText variant="caption" muted>
        {t('consent.notSent')}
      </AppText>
      <AppText variant="caption" muted>
        {t('consent.terms', { provider })}
      </AppText>
      <Button label={t('consent.sample')} variant="ghost" icon="eye" onPress={onSample} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  list: { gap: spacing.xs },
});
