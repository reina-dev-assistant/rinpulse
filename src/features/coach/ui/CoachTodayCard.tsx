import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { FadeIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { spacing } from '@/theme';
import { useCoach } from '../useCoach';
import { useCoachAccess } from '../useCoachAccess';
import { AiInsightInline, AiInsightStandalone } from '@/features/ai/ui/AiInsight';
import { UpgradeCard } from '@/features/pro/UpgradeCard';
import { CoachSignIn } from './CoachGate';
import { FeelPicker } from './FeelPicker';
import { SuggestionBlock } from './SuggestionBlock';

function ProCard({ dataVersion, availability }: { dataVersion: number; availability: NightHrvAvailability | null }) {
  const { t } = useTranslation('coach');
  const router = useRouter();
  const coach = useCoach(dataVersion, availability);
  if (!coach) return <Skeleton width="100%" height={150} radius="card" />;
  const hasPlan = coach.progress !== null;
  return (
    <FadeIn>
      <Card>
        <PressableScale accessibilityRole="button" accessibilityLabel={t('card.details')} onPress={() => router.push('/coach')} scaleTo={0.99}>
          <SuggestionBlock suggestion={coach.suggestion} maxReasons={2} />
        </PressableScale>
        <AiInsightInline coach={coach} />
        {coach.needsFeel ? <FeelPicker feel={coach.feel} onChange={coach.setFeel} /> : null}
        <View style={styles.actions}>
          <Button label={t('card.details')} variant="secondary" icon="chevron-forward" onPress={() => router.push('/coach')} style={styles.action} />
          {hasPlan ? null : <Button label={t('card.createPlan')} variant="primary" icon="add" onPress={() => router.push('/coach/setup')} style={styles.action} />}
        </View>
      </Card>
    </FadeIn>
  );
}

/**
 * The Today card of Coach: today's suggestion (rule based, see `suggest.ts`) with its reasons and a way into the Coach screen.
 * Pro accounts get the suggestion; a signed-out person is asked to sign in and a free account sees the Pro upsell.
 * In the account-free mode (Settings > Coach) everyone gets the suggestion, since it needs no server.
 * Renders nothing while the account is still being checked.
 *
 * Joyo AI's opt-in summary (own key, off by default) sits under the headline for Pro. A signed-out or free account does not see the
 * Coach card, so the summary is its own small card above the sign-in or upsell card; it needs no JoyoRogo account.
 */
export function CoachTodayCard({ dataVersion, availability }: { dataVersion: number; availability: NightHrvAvailability | null }) {
  const access = useCoachAccess();
  if (access === 'checking') return null;
  if (access === 'signedOut' || access === 'free') {
    return (
      <>
        <AiInsightStandalone dataVersion={dataVersion} availability={availability} />
        {access === 'signedOut' ? <CoachSignIn /> : <UpgradeCard moment="coach-today" dismissible />}
      </>
    );
  }
  return <ProCard dataVersion={dataVersion} availability={availability} />;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: { flex: 1 },
});
