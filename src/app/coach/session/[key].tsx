import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card, Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { markSession } from '@/features/coach/actions';
import { StrengthSessionSection } from '@/features/coach/ui/StrengthSessionSection';
import { liveDone } from '@/features/coach/doc';
import { sessionTitle, spanText, whatText, zoneBpm } from '@/features/coach/format';
import { paceTarget } from '@/features/coach/pace';
import { allSessions, generatePlan } from '@/features/coach/plans/generate';
import type { PlannedSession } from '@/features/coach/plans/types';
import { sessionStatus } from '@/features/coach/progress';
import { CoachGate } from '@/features/coach/ui/CoachGate';
import { useCoach, type CoachState } from '@/features/coach/useCoach';
import { useThresholdPace } from '@/features/coach/useThresholdPace';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { userMaxHr } from '@/features/workouts/useWorkoutStrain';
import { formatPace as paceClock } from '@/features/workouts/analysis/types';
import { fmtDay, fmtDistance, fmtInt, useLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/** The lines of a session's layout: warm-up, the main part, cool-down. */
function useSteps(session: PlannedSession): string[] {
  const { t } = useTranslation('coach');
  useLocale();
  const run = session.run;
  if (!run) return [];
  const steps: string[] = [];
  const warm = run.walkRun?.warmupMin ?? run.tempo?.warmupMin ?? run.intervals?.warmupMin ?? 0;
  const cool = run.walkRun?.cooldownMin ?? run.tempo?.cooldownMin ?? run.intervals?.cooldownMin ?? 0;
  if (warm > 0) steps.push(t('session.steps.warmup', { minutes: fmtInt(warm) }));
  switch (run.type) {
    case 'walkrun':
      steps.push(t('session.steps.walkrun', { reps: fmtInt(run.walkRun?.reps ?? 0), run: spanText(run.walkRun?.runSec ?? 0), walk: spanText(run.walkRun?.walkSec ?? 0) }));
      break;
    case 'tempo':
      steps.push(t('session.steps.tempo', { minutes: fmtInt(run.tempo?.mainMin ?? 0) }));
      break;
    case 'intervals':
      steps.push(t('session.steps.intervals', { reps: fmtInt(run.intervals?.reps ?? 0), work: spanText(run.intervals?.workSec ?? 0), rest: spanText(run.intervals?.restSec ?? 0) }));
      break;
    case 'race':
      steps.push(t('session.steps.race', { distance: fmtDistance(run.distanceM ?? 0) }));
      break;
    default:
      steps.push(t(`session.steps.${run.type}`));
  }
  if (cool > 0) steps.push(t('session.steps.cooldown', { minutes: fmtInt(cool) }));
  return steps;
}

function SessionDetail({ session, coach }: { session: PlannedSession; coach: CoachState }) {
  const { t } = useTranslation('coach');
  useLocale();
  const router = useRouter();
  const db = useSQLiteContext();
  const cloud = useCloud();
  const threshold = useThresholdPace(db, coach.data.workouts, coach.data.nowSec);
  const steps = useSteps(session);
  const maxHr = useMemo(() => userMaxHr(), []);

  const status = sessionStatus(session, coach.doc.done, coach.today);
  const entry = liveDone(coach.doc.done)[session.key];
  const run = session.run;
  const zone = run?.zone ?? null;
  const range = zone ? zoneBpm(zone, maxHr) : null;
  const pace = run && threshold ? paceTarget(run.type, threshold) : null;

  const mark = (kind: 'done' | 'skipped' | 'undo') => {
    void markSession(db, session.key, kind).then(() => {
      if (cloud.signedIn) void cloud.syncNow().catch(() => {});
    });
  };

  const openWorkout = async () => {
    if (!entry?.workoutStart) return;
    const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM workouts WHERE start = ?', entry.workoutStart);
    if (row) router.push({ pathname: '/workouts/[id]', params: { id: String(row.id) } });
  };

  const stateText =
    status === 'done'
      ? entry?.manual
        ? t('session.state.doneHand')
        : t('session.state.doneWatch')
      : status === 'skipped'
        ? t('session.state.skipped')
        : t(`session.state.${status === 'beforeStart' ? 'upcoming' : status}`);

  return (
    <>
      <Card>
        <AppText variant="heading">{sessionTitle(session)}</AppText>
        <AppText variant="caption" muted>
          {t('session.when', { date: fmtDay(session.day, 'long'), week: fmtInt(session.week + 1) })}
        </AppText>
        <AppText variant="bodyStrong">{whatText({ type: session.type, minutes: session.minutes, zone }, session)}</AppText>
        <AppText variant="caption" muted>
          {stateText}
        </AppText>
      </Card>

      {session.kind === 'run' ? (
      <Section title={t('session.steps.title')} icon="list" tint="workouts">
        <View style={styles.list}>
          {steps.map((line, index) => (
            <AppText key={index} variant="body">
              {`${index + 1}. ${line}`}
            </AppText>
          ))}
        </View>
        <AppText variant="caption" muted>
          {t('session.total', { minutes: fmtInt(session.minutes) })}
        </AppText>
      </Section>
      ) : (
        <StrengthSessionSection
          session={session}
          todayScalePct={coach.suggestion.session?.key === session.key && coach.suggestion.kind === 'sessionScaled' ? coach.suggestion.scalePct : 100}
          canStart={status !== 'done' && status !== 'skipped' && status !== 'beforeStart'}
        />
      )}

      {zone && range ? (
        <Section title={t('session.zone', { zone: fmtInt(zone) })} icon="heart" tint="heart">
          <AppText variant="body">{t('session.zoneRange', { zone: fmtInt(zone), from: fmtInt(range.from), to: fmtInt(range.to) })}</AppText>
          {pace ? (
            <AppText variant="body">{t('session.paceTarget', { fast: paceClock(pace.fast), slow: paceClock(pace.slow) })}</AppText>
          ) : run && run.type !== 'walkrun' && run.type !== 'race' ? (
            <AppText variant="caption" muted>
              {t('session.paceUnknown')}
            </AppText>
          ) : null}
        </Section>
      ) : null}

      {status === 'done' && entry?.workoutStart ? <Button label={t('session.openWorkout')} variant="secondary" icon="open-outline" onPress={() => void openWorkout()} /> : null}
      {status === 'done' || status === 'skipped' ? (
        <Button label={t('session.mark.undo')} variant="ghost" icon="arrow-undo" onPress={() => mark('undo')} />
      ) : status === 'beforeStart' ? null : (
        <View style={styles.buttons}>
          <Button label={t('session.mark.done')} variant="primary" icon="checkmark" onPress={() => mark('done')} />
          <Button label={t('session.mark.skip')} variant="secondary" icon="play-skip-forward" onPress={() => mark('skipped')} />
        </View>
      )}
      <AppText variant="caption" muted>
        {t('disclaimer')}
      </AppText>
    </>
  );
}

function SessionByKey() {
  const { t } = useTranslation('coach');
  const { key } = useLocalSearchParams<{ key: string }>();
  const { dataVersion } = useWatch();
  const availability = useNightHrvAvailability(dataVersion);
  const coach = useCoach(dataVersion, availability);
  const session = useMemo(() => {
    const plan = coach?.doc.plan;
    return plan ? (allSessions(generatePlan(plan)).find((s) => s.key === key) ?? null) : null;
  }, [coach?.doc.plan, key]);
  if (!coach) return <Skeleton width="100%" height={220} radius="card" />;
  if (!session) return <Notice>{t('session.notFound')}</Notice>;
  return <SessionDetail session={session} coach={coach} />;
}

export default function CoachSessionScreen() {
  return (
    <Screen>
      <CoachGate campaign="evergreen-coach-session">
        <SessionByKey />
      </CoachGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  buttons: { gap: spacing.sm },
  spacer: { height: spacing.sm },
});
