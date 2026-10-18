import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Section } from '@/components/Screen';
import { formatPace as paceClock, type WorkoutAnalysis } from '@/features/workouts/analysis/types';
import { fmtDistance, fmtDuration, fmtInt, t as translate, useLocale } from '@/i18n';
import { spacing } from '@/theme';
import { liveDone } from '../doc';
import { sessionFeedback, type FeedbackLine } from '../feedback';
import { sessionTitle, whatText } from '../format';
import { allSessions, generatePlan } from '../plans/generate';
import { loadCoachDoc, useCoachDoc } from '../store';



/** The sentence of one feedback line; the numbers come with it so the same rules produce the same words. */
function lineText(line: FeedbackLine, group: 'easy' | 'tempo' | 'intervals' | 'walkrun'): string {
  const v = line.values;
  switch (line.key) {
    case 'duration':
      return translate(`coach:feedback.duration.${line.verdict}`, { actual: fmtDuration(v.actualSec ?? 0), planned: fmtDuration(v.plannedSec ?? 0) });
    case 'pace':
      return translate(`coach:feedback.pace.${line.verdict}`, { actual: paceClock(v.actual), fast: paceClock(v.fast), slow: paceClock(v.slow) });
    case 'distance':
      return translate(`coach:feedback.distance.${line.verdict === 'on' ? 'on' : 'under'}`, { actual: fmtDistance(v.actualM ?? 0), planned: fmtDistance(v.plannedM ?? 0) });
    case 'zone': {
      switch (group) {
        case 'easy':
          return translate(`coach:feedback.zone.easy.${line.verdict === 'over' ? 'over' : 'on'}`, { share: fmtInt(v.aboveShare ?? 0), target: fmtInt(v.target ?? 2) });
        case 'tempo':
          return translate(`coach:feedback.zone.tempo.${line.verdict}`, { share: fmtInt(line.verdict === 'over' ? (v.z5Share ?? 0) : (v.inShare ?? 0)) });
        case 'intervals':
          return translate(`coach:feedback.zone.intervals.${line.verdict === 'on' ? 'on' : 'under'}`, { actual: fmtDuration(v.hardSec ?? 0), planned: fmtDuration(v.plannedSec ?? 0) });
        case 'walkrun':
          return translate(`coach:feedback.zone.walkrun.${line.verdict === 'over' ? 'over' : 'on'}`, { share: fmtInt(v.aboveShare ?? 0) });
      }
    }
  }
}

/**
 * On the workout detail: the workout against the plan session it was matched to (duration, heart-rate zone, pace,
 * distance, from the analysis the screen already computed). Renders nothing for a workout that no plan session claimed.
 */
export function CoachFeedbackSection({ workoutStart, analysis }: { workoutStart: number; analysis: WorkoutAnalysis | null }) {
  const { t } = useTranslation('coach');
  useLocale();
  const db = useSQLiteContext();
  const doc = useCoachDoc();

  useEffect(() => {
    void loadCoachDoc(db).catch(() => {});
  }, [db]);

  const matched = useMemo(() => {
    const plan = doc?.plan;
    if (!doc || !plan) return null;
    const key = Object.entries(liveDone(doc.done)).find(([, entry]) => entry.workoutStart === workoutStart)?.[0];
    if (!key) return null;
    return allSessions(generatePlan(plan)).find((s) => s.key === key) ?? null;
  }, [doc, workoutStart]);

  const feedback = useMemo(() => (matched && analysis ? sessionFeedback(matched, analysis) : null), [matched, analysis]);
  if (!matched || !feedback) return null;

  const type = matched.type;
  const group = type === 'tempo' ? 'tempo' : type === 'intervals' ? 'intervals' : type === 'walkrun' ? 'walkrun' : 'easy';
  return (
    <Section title={t('feedback.title')} icon="flag" tint="workouts">
      <AppText variant="bodyStrong">{t('feedback.planned', { what: matched.run ? whatText({ type: matched.type, minutes: matched.minutes, zone: matched.run.zone }, matched) : sessionTitle(matched) })}</AppText>
      <View style={styles.lines}>
        {feedback.lines.map((line) => (
          <AppText key={line.key} variant="caption" muted>
            {`\u2022 ${lineText(line, group)}`}
          </AppText>
        ))}
      </View>
      <AppText variant="body">{t(`feedback.overall.${feedback.overall}`)}</AppText>
    </Section>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 2 },
});
