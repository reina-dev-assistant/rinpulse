import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ChipRow } from '@/components/ChipRow';
import { Field } from '@/components/Input';
import { Card, Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { userWeightKg } from '@/features/strength/profile';
import {
  MANUAL_SPORTS,
  SPORT_ROWS,
  estimateManualKcal,
  manualRow,
  parseClock,
  parseKcal,
  parseKm,
  parseMinutes,
  startAt,
  type ManualSport,
} from '@/features/workouts/manual';
import { saveManualWorkout } from '@/features/workouts/manualStore';
import { sportLabel } from '@/features/workouts/sportLabel';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

const DAYS = [0, 1, 2] as const;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Log a workout by hand: a run, ride or walk the phone did not record. Heart rate and route stay empty; energy is estimated unless typed. */
export default function ManualWorkoutScreen() {
  const { t } = useTranslation('workouts');
  const db = useSQLiteContext();
  const router = useRouter();
  const { dataChanged } = useWatch();
  const [sport, setSport] = useState<ManualSport>('run');
  const [daysAgo, setDaysAgo] = useState<number>(0);
  const [clock, setClock] = useState(() => {
    const now = new Date();
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  const [minutes, setMinutes] = useState('');
  const [km, setKm] = useState('');
  const [kcal, setKcal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const weight = userWeightKg();
  const parsedMinutes = parseMinutes(minutes);
  const hint = parsedMinutes === null ? null : t('manual.estimate', { kcal: estimateManualKcal(sport, parsedMinutes, weight), kg: weight });

  const save = async () => {
    const time = parseClock(clock);
    const duration = parseMinutes(minutes);
    const distance = parseKm(km);
    const energy = parseKcal(kcal);
    if (!time) return setError(t('manual.errors.clock'));
    if (duration === null) return setError(t('manual.errors.minutes'));
    if (!distance.ok) return setError(t('manual.errors.km'));
    if (!energy.ok) return setError(t('manual.errors.kcal'));
    const start = startAt(new Date(), daysAgo, time);
    if (start * 1000 > Date.now()) return setError(t('manual.errors.future'));
    setSaving(true);
    setError(null);
    try {
      const id = await saveManualWorkout(db, manualRow({ sport, start, minutes: duration, km: distance.km, kcal: energy.kcal, weightKg: weight }));
      dataChanged();
      router.replace({ pathname: '/workouts/[id]', params: { id: String(id) } });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('manual.title') }} />
      <AppText variant="caption" muted>
        {t('manual.intro')}
      </AppText>
      <ChipRow
        items={MANUAL_SPORTS.map((s) => ({ key: s, label: sportLabel(SPORT_ROWS[s].name), selected: sport === s, role: 'radio' as const, onPress: () => setSport(s) }))}
      />
      <Card>
        <AppText variant="label" muted>
          {t('manual.day')}
        </AppText>
        <Segmented options={DAYS.map((d) => ({ value: d, label: t(`manual.days.${d}`) }))} value={daysAgo} onChange={setDaysAgo} />
        <View style={styles.row}>
          <View style={styles.cell}>
            <Field label={t('manual.start')} icon="time-outline" value={clock} onChangeText={setClock} keyboardType="numbers-and-punctuation" />
          </View>
          <View style={styles.cell}>
            <Field label={t('manual.minutes')} icon="hourglass-outline" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" placeholder="45" />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.cell}>
            <Field label={t('manual.km')} icon="trail-sign-outline" value={km} onChangeText={setKm} keyboardType="decimal-pad" placeholder={t('manual.optional')} />
          </View>
          <View style={styles.cell}>
            <Field label={t('manual.kcal')} icon="flame-outline" value={kcal} onChangeText={setKcal} keyboardType="number-pad" placeholder={t('manual.optional')} />
          </View>
        </View>
        {hint ? (
          <AppText variant="caption" muted>
            {hint}
          </AppText>
        ) : null}
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={t('manual.save')} variant="primary" icon="checkmark" loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1 },
});
