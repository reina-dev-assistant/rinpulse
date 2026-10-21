import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Card } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { AppText } from '@/components/AppText';
import type { ProMoment } from '@/features/pro/offer';
import { UpgradeCard } from '@/features/pro/UpgradeCard';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { useCoachAccess } from '../useCoachAccess';

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
export function CoachGate({ children, moment = 'coach' }: { children: ReactNode; moment?: ProMoment }) {
  const access = useCoachAccess();
  if (access === 'checking') return <Skeleton width="100%" height={140} radius="card" />;
  if (access === 'signedOut') return <CoachSignIn />;
  if (access === 'free') return <UpgradeCard moment={moment} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
});
