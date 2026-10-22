import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip, type IconName } from '@/components/IconChip';
import { Card } from '@/components/Screen';
import { spacing } from '@/theme';
import type { ByokBlock } from '../access';
import { aiSettings } from '../stores';
import type { ProviderId } from '../types';

const ICON: Record<ByokBlock, IconName> = {
  noProvider: 'key',
  noKey: 'key',
  noConsent: 'shield-checkmark',
  badUrl: 'link',
  minor: 'person',
};

/**
 * The own-key chat cannot run: one card per reason, saying why and giving the one way forward. Nothing is sent while this shows.
 * Under 18 there is no way forward for the own key; the hosted engine stays.
 */
export function GateCard({ reason, provider }: { reason: ByokBlock; provider: ProviderId | null }) {
  const { t } = useTranslation('ai');
  const router = useRouter();
  const name = provider ? t(`provider.${provider}`) : '';
  const useHosted = () => aiSettings.update({ engine: 'rogo' });
  return (
    <Card>
      <View style={styles.head}>
        <IconChip icon={ICON[reason]} tint="link" />
        <AppText variant="heading" style={styles.title}>
          {t(`gate.${reason}.title`)}
        </AppText>
      </View>
      <AppText variant="caption" muted>
        {t(`gate.${reason}.body`, { provider: name })}
      </AppText>
      {reason === 'minor' ? (
        <Button label={t('gate.useHosted')} variant="primary" icon="swap-horizontal" onPress={useHosted} />
      ) : (
        <>
          <Button label={t(`gate.${reason}.action`)} variant="primary" icon="key" onPress={() => router.push('/settings/ai-setup')} />
          <Button label={t('gate.useHosted')} variant="ghost" onPress={useHosted} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
});
