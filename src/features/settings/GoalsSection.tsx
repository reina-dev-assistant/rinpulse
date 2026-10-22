import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { Field } from '@/components/Input';
import { Divider, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { MAX_STEP_GOAL, MIN_STEP_GOAL, parseStepGoal } from '@/features/today/stepGoal';
import { errorMessage, formatDateTime } from '@/format';
import { t } from '@/i18n';
import { HuaweiWear, type ActivityGoals } from '@/wear';
import { spacing } from '@/theme';

/** Huawei Health's defaults: 10 000 steps, 300 active kcal, 30 exercise minutes, 12 stand hours, all reminders on. */
const HUAWEI_DEFAULTS: ActivityGoals = {
  steps: 10_000,
  calories: 300,
  exerciseMinutes: 30,
  standHours: 12,
  remindStand: true,
  remindProgress: true,
  remindGoalReached: true,
};

interface Fields {
  steps: string;
  calories: string;
  exercise: string;
  stand: string;
}

const toFields = (goals: ActivityGoals): Fields => ({
  steps: String(goals.steps),
  calories: String(goals.calories),
  exercise: String(goals.exerciseMinutes),
  stand: String(goals.standHours),
});

function whole(text: string, min: number, max: number, what: string): number | string {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < min || n > max) return t('settings:goals.errors.whole', { what, min, max });
  return n;
}

/** The four goals from the form, or the first message that explains what is out of range. */
function parseFields(fields: Fields, reminders: Pick<ActivityGoals, 'remindStand' | 'remindProgress' | 'remindGoalReached'>): ActivityGoals | string {
  const steps = parseStepGoal(fields.steps) ?? t('settings:goals.errors.whole', { what: t('settings:goals.errors.steps'), min: MIN_STEP_GOAL, max: MAX_STEP_GOAL });
  const calories = whole(fields.calories, 50, 10_000, t('settings:goals.errors.calories'));
  const exerciseMinutes = whole(fields.exercise, 1, 600, t('settings:goals.errors.exercise'));
  const standHours = whole(fields.stand, 1, 24, t('settings:goals.errors.stand'));
  for (const value of [steps, calories, exerciseMinutes, standHours]) if (typeof value === 'string') return value;
  return { steps: steps as number, calories: calories as number, exerciseMinutes: exerciseMinutes as number, standHours: standHours as number, ...reminders };
}

/** Activity-ring goals and reminders, sent to the watch on save and on every connect. */
export function GoalsSection() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState(() => HuaweiWear.getActivityGoals());
  const [fields, setFields] = useState<Fields>(() => toFields(HuaweiWear.getActivityGoals()));
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setStatus(HuaweiWear.getActivityGoals()), []);
  useNativeRefresh(reload);

  const edit = (key: keyof Fields) => (text: string) => {
    setFields((current) => ({ ...current, [key]: text }));
    setMessage(null);
  };

  const apply = async (goals: ActivityGoals) => {
    setBusy(true);
    setMessage(null);
    try {
      const sent = await HuaweiWear.setActivityGoals(goals);
      setMessage({ text: sent ? t('goals.sent') : t('goals.saved'), danger: false });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setBusy(false);
      reload();
    }
  };

  const save = () => {
    const parsed = parseFields(fields, status);
    if (typeof parsed === 'string') setMessage({ text: parsed, danger: true });
    else void apply(parsed);
  };

  // A reminder switch applies at once, with the goals as last saved (unsaved edits in the boxes stay as typed).
  const toggle = (key: 'remindStand' | 'remindProgress' | 'remindGoalReached') => (value: boolean) =>
    void apply({
      steps: status.steps,
      calories: status.calories,
      exerciseMinutes: status.exerciseMinutes,
      standHours: status.standHours,
      remindStand: status.remindStand,
      remindProgress: status.remindProgress,
      remindGoalReached: status.remindGoalReached,
      [key]: value,
    });

  const reset = () => {
    setFields(toFields(HUAWEI_DEFAULTS));
    void apply(HUAWEI_DEFAULTS);
  };

  return (
    <Section title={t('goals.title')} icon="flag">
      <View style={styles.row}>
        <View style={styles.cell}>
          <Field label={t('goals.fields.steps')} icon="footsteps" keyboardType="number-pad" value={fields.steps} onChangeText={edit('steps')} />
        </View>
        <View style={styles.cell}>
          <Field label={t('goals.fields.calories')} icon="flame" keyboardType="number-pad" value={fields.calories} onChangeText={edit('calories')} />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.cell}>
          <Field label={t('goals.fields.exercise')} icon="timer" keyboardType="number-pad" value={fields.exercise} onChangeText={edit('exercise')} />
        </View>
        <View style={styles.cell}>
          <Field label={t('goals.fields.stand')} icon="body" keyboardType="number-pad" value={fields.stand} onChangeText={edit('stand')} />
        </View>
      </View>
      {message ? <Notice tone={message.danger ? 'danger' : 'info'}>{message.text}</Notice> : null}
      <ButtonRow>
        <Button label={t('goals.saveAndSend')} variant="primary" icon="send" loading={busy} onPress={save} />
        <Button label={t('goals.defaults')} variant="secondary" disabled={busy} onPress={reset} />
      </ButtonRow>
      <Divider />
      <SwitchRow
        icon="walk"
        label={t('goals.reminders.stand')}
        value={status.remindStand}
        disabled={busy}
        onValueChange={toggle('remindStand')}
      />
      <SwitchRow
        icon="speedometer"
        label={t('goals.reminders.progress')}
        value={status.remindProgress}
        disabled={busy}
        onValueChange={toggle('remindProgress')}
      />
      <SwitchRow
        icon="trophy"
        label={t('goals.reminders.reached')}
        value={status.remindGoalReached}
        disabled={busy}
        onValueChange={toggle('remindGoalReached')}
      />
      <PairGrid>
        <Pair
          label={t('goals.accepts')}
          value={status.configSupported === null
              ? t('goals.acceptsNotConnected')
              : status.configSupported
                ? t('goals.acceptsYes')
                : t('goals.acceptsNo')}
        />
        <Pair label={t('goals.lastSend')} value={status.lastSentAt ? formatDateTime(status.lastSentAt / 1000) : null} />
      </PairGrid>
      <Details>{t('goals.details')}</Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1 },
});
