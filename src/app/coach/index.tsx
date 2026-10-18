import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Details } from '@/components/Details';
import { Card, Screen, Section } from '@/components/Screen';
import { NavRow } from '@/components/NavRow';
import { EXERCISES } from '@/features/coach/exercises';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { endPlan } from '@/features/coach/actions';
import { sessionStatus } from '@/features/coach/progress';
import { useCoach } from '@/features/coach/useCoach';
import { CoachGate } from '@/features/coach/ui/CoachGate';
import { SessionRow } from '@/features/coach/ui/SessionRow';
import { FeelPicker } from '@/features/coach/ui/FeelPicker';
import { SuggestionBlock } from '@/features/coach/ui/SuggestionBlock';
import { SharePlanButton } from '@/features/stickers/ui/SharePlanButton';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { fmtDay, fmtInt, useLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

function CoachBody() {
  const { t } = useTranslation('coach');
  useLocale();
  const router = useRouter();
  const db = useSQLiteContext();
  const cloud = useCloud();
  const { dataVersion } = useWatch();
  const availability = useNightHrvAvailability(dataVersion);
  const coach = useCoach(dataVersion, availability);
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!coach) return <Skeleton width="100%" height={220} radius="card" />;
  const { progress, suggestion, doc, today } = coach;

  const openSession = (key: string) => router.push({ pathname: '/coach/session/[key]', params: { key } });
  const afterChange = () => {
    if (cloud.signedIn) void cloud.syncNow().catch(() => {});
  };

  if (!progress) {
    return (
      <>
        <Card>
          <SuggestionBlock suggestion={suggestion} />
          {coach.needsFeel ? <FeelPicker feel={coach.feel} onChange={coach.setFeel} /> : null}
        </Card>
        <EmptyState
          icon="calendar"
          title={t('plan.empty.title')}
          description={t('plan.empty.body')}
          action={{ label: t('card.createPlan'), icon: 'add', onPress: () => router.push('/coach/setup') }}
        />
      </>
    );
  }

  const { plan, weeks, weekIndex } = progress;
  const week = weeks[weekIndex];
  const adjust = plan.adjust[String(weekIndex)];
  const shownSessions = week?.sessions.filter((s) => !s.beforeStart) ?? [];

  return (
    <>
      <Card>
        <AppText variant="heading">{t(`plan.name.${plan.goal}`)}</AppText>
        <AppText variant="caption" muted>
          {t('plan.summary', { name: t(`plan.name.${plan.goal}`), level: t(`level.${plan.level}`), days: fmtInt(plan.daysPerWeek) })}
        </AppText>
        <AppText variant="bodyStrong">
          {progress.state === 'finished'
            ? t('plan.finished')
            : progress.state === 'upcoming'
              ? t('plan.notStarted', { date: fmtDay(plan.startDay, 'weekday') })
              : t('plan.weekOf', { week: fmtInt(weekIndex + 1), weeks: fmtInt(plan.weeks) })}
        </AppText>
        {week ? (
          <AppText variant="caption" muted>
            {`${t('plan.doneOfPlanned', { done: fmtInt(progress.doneThisWeek), planned: fmtInt(progress.plannedThisWeek) })} \u00b7 ${t(`plan.phase.${week.phase}`)}`}
          </AppText>
        ) : null}
        <SharePlanButton progress={progress} done={doc.done} />
      </Card>

      <Section title={t('card.title')} icon="flash" tint="workouts">
        <SuggestionBlock suggestion={suggestion} />
        {coach.needsFeel ? <FeelPicker feel={coach.feel} onChange={coach.setFeel} /> : null}
        <Details title={t('rules.title')}>{t('rules.body')}</Details>
      </Section>

      {adjust && weekIndex > 0 ? (
        <Notice icon="options">{`${t('plan.adapt.title')}: ${t(`plan.adapt.reason.${adjust.reason}`)} (${t('plan.scale', { pct: fmtInt(adjust.scalePct) })})`}</Notice>
      ) : null}

      <Section title={t('plan.thisWeek')} icon="calendar" tint="workouts">
        <View style={styles.list}>
          {shownSessions.map((session) => (
            <SessionRow key={session.key} session={session} status={sessionStatus(session, doc.done, today)} onPress={() => openSession(session.key)} />
          ))}
        </View>
      </Section>

      <Details title={t('plan.allWeeks')}>
        <View style={styles.weeks}>
          {weeks.map((w) => (
            <View key={w.index} style={styles.weekBlock}>
              <AppText variant="bodyStrong">
                {`${t('plan.weekLine', { week: fmtInt(w.index + 1) })} \u00b7 ${t(`plan.phase.${w.phase}`)}${w.scalePct < 100 ? ` \u00b7 ${t('plan.scale', { pct: fmtInt(w.scalePct) })}` : ''}`}
              </AppText>
              {w.sessions
                .filter((s) => !s.beforeStart)
                .map((s) => (
                  <SessionRow key={s.key} session={s} status={sessionStatus(s, doc.done, today)} onPress={() => openSession(s.key)} />
                ))}
            </View>
          ))}
        </View>
      </Details>

      <AppText variant="caption" muted>
        {t('plan.synced')}
      </AppText>
      <AppText variant="caption" muted>
        {t('disclaimer')}
      </AppText>

      <View style={styles.buttons}>
        <Button label={t('plan.change')} variant="secondary" icon="swap-horizontal" onPress={() => router.push('/coach/setup')} />
        <Button label={t('plan.end.cta')} variant="destructive" icon="close-circle" onPress={() => setConfirmEnd(true)} />
      </View>
      <ConfirmDialog
        visible={confirmEnd}
        title={t('plan.end.title')}
        message={t('plan.end.message')}
        confirmLabel={t('plan.end.confirm')}
        cancelLabel={t('plan.end.cancel')}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          void endPlan(db).then(afterChange);
        }}
      />
    </>
  );
}

function LibraryRow() {
  const { t } = useTranslation('coach');
  const router = useRouter();
  return (
    <Card>
      <NavRow icon="chatbubbles" tint="link" title={t('home.chat.title')} subtitle={t('home.chat.subtitle')} onPress={() => router.push('/coach/chat')} />
      <NavRow icon="barbell" tint="workouts" title={t('home.library.title')} subtitle={t('home.library.subtitle', { n: fmtInt(EXERCISES.length) })} onPress={() => router.push('/coach/library')} />
    </Card>
  );
}

export default function CoachScreen() {
  return (
    <Screen>
      <CoachGate campaign="evergreen-coach-screen">
        <CoachBody />
      </CoachGate>
      <LibraryRow />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  weeks: { gap: spacing.md },
  weekBlock: { gap: spacing.xs },
  buttons: { gap: spacing.sm },
});
