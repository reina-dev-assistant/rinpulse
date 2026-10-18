import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Card } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { AppText } from '@/components/AppText';
import { ProUpsell, type ProUpsellCopy } from '@/features/social/ProUpsell';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { useCoachAccess } from '../useCoachAccess';

/** The Pro upsell with Coach's own words. */
export function CoachUpsell({ campaign }: { campaign: string }) {
  const { t } = useTranslation('coach');
  const copy: ProUpsellCopy = {
    title: t('access.upsell.title'),
    description: t('access.upsell.description'),
    seeLabel: t('access.upsell.see'),
    openLabel: t('access.upsell.open'),
    mention: t('access.upsell.mention'),
  };
  return <ProUpsell copy={copy} campaign={campaign} />;
}

/** Asks a signed-out person to sign in (Settings, Cloud sync, is where the JoyoRogo sign-in lives). */
export function CoachSignIn() {
  const { t } = useTranslation('coach');
  const router = useRouter();
  return (
    <Card>
      <View style={styles.head}>
        <IconChip icon="log-in" tint="link" />
        <AppText variant="heading" style={styles.title}>
          {t('access.signIn.title')}
        </AppText>
      </View>
      <AppText variant="caption" muted>
        {t('access.signIn.body')}
      </AppText>
      <Button label={t('access.signIn.cta')} variant="primary" icon="log-in" onPress={() => router.push('/settings/akun')} />
    </Card>
  );
}

/** Shows `children` to Pro accounts, the sign-in or upsell card to everyone else. */
export function CoachGate({ children, campaign = 'evergreen-coach' }: { children: ReactNode; campaign?: string }) {
  const access = useCoachAccess();
  if (access === 'checking') return <Skeleton width="100%" height={140} radius="card" />;
  if (access === 'signedOut') return <CoachSignIn />;
  if (access === 'free') return <CoachUpsell campaign={campaign} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
});
