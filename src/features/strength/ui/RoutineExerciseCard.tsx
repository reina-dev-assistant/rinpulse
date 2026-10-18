import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Screen';
import { IconAction } from '@/features/courses/IconAction';
import { fmtInt, fmtNumber } from '@/i18n';
import { HIT, spacing, useColors, useTheme } from '@/theme';

import { MAX_REST_SEC, MIN_REST_SEC, setLabels } from '../draft';
import { MAX_REPS, MAX_SECONDS, MAX_WEIGHT_KG, parseAmount, type EditExercise, type SetPatch } from '../routineEdit';

/** Seconds one tap on the rest stepper adds or takes away. */
const REST_STEP = 15;

interface NumberCellProps {
  value: number | null;
  max: number;
  decimals: number;
  label: string;
  placeholder?: string;
  keyboard: 'decimal-pad' | 'number-pad';
  onChange: (value: number | null) => void;
}

/**
 * A kg, repetitions or seconds box. It keeps what is being typed ("12," on the way to "12,5"); when the value changes from outside
 * (a set above was removed and this row now shows another set) it shows the new value.
 */
function NumberCell({ value, max, decimals, label, placeholder, keyboard, onChange }: NumberCellProps) {
  const shown = (v: number | null) => (v === null ? '' : fmtNumber(v, decimals));
  const [text, setText] = useState(shown(value));
  useEffect(() => {
    setText((current) => (parseAmount(current, max, decimals) === value ? current : shown(value)));
    // `shown` only depends on the language; a language switch while typing is not worth a redraw of the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, max, decimals]);
  return (
    <View style={styles.cell}>
      <Input
        value={text}
        onChangeText={(next) => {
          setText(next);
          onChange(parseAmount(next, max, decimals));
        }}
        keyboardType={keyboard}
        placeholder={placeholder}
        accessibilityLabel={label}
        maxLength={7}
        selectTextOnFocus
        style={styles.number}
      />
    </View>
  );
}

interface RoutineExerciseCardProps {
  exercise: EditExercise;
  name: string;
  timed: boolean;
  /** The rest used when the exercise has none of its own, seconds. */
  defaultRestSec: number;
  onMenu: () => void;
  onNote: (note: string) => void;
  onRest: (restSec: number) => void;
  onSetPatch: (setIndex: number, patch: SetPatch) => void;
  onSetType: (setIndex: number) => void;
  onAddSet: () => void;
  onRemoveSet: (setIndex: number) => void;
}

/** One exercise of a routine in the editor: name and menu, rest, note, and the table of its sets. */
export function RoutineExerciseCard({
  exercise,
  name,
  timed,
  defaultRestSec,
  onMenu,
  onNote,
  onRest,
  onSetPatch,
  onSetType,
  onAddSet,
  onRemoveSet,
}: RoutineExerciseCardProps) {
  const { t } = useTranslation('routines');
  const colors = useColors();
  const { radius } = useTheme();
  const labels = setLabels(exercise.sets);
  const rest = exercise.restSec ?? defaultRestSec;
  const step = (delta: number) => onRest(Math.min(MAX_REST_SEC, Math.max(MIN_REST_SEC, rest + delta)));
  const linked = exercise.supersetGroup !== null;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        {linked ? <View style={[styles.bar, { backgroundColor: colors.primary }]} /> : null}
        <View style={styles.headText}>
          <AppText variant="heading" numberOfLines={2}>
            {name}
          </AppText>
          {linked ? (
            <AppText variant="caption" color={colors.primary}>
              {t('editor.superset')}
            </AppText>
          ) : null}
        </View>
        <IconAction icon="ellipsis-horizontal" label={t('editor.exerciseMenu', { name })} onPress={onMenu} />
      </View>

      <Input
        value={exercise.note}
        onChangeText={onNote}
        placeholder={t('editor.exerciseNote')}
        accessibilityLabel={t('editor.exerciseNoteLabel', { name })}
        maxLength={200}
        icon="create-outline"
      />

      <View style={styles.restRow}>
        <View style={styles.restText}>
          <AppText variant="label" muted>
            {t('editor.rest.label')}
          </AppText>
          <AppText variant="bodyStrong">
            {exercise.restSec === null ? t('editor.rest.default', { value: fmtInt(rest) }) : t('editor.rest.seconds', { value: fmtInt(rest) })}
          </AppText>
        </View>
        <IconAction icon="remove" label={t('editor.rest.less', { name })} onPress={() => step(-REST_STEP)} disabled={rest <= MIN_REST_SEC} />
        <IconAction icon="add" label={t('editor.rest.more', { name })} onPress={() => step(REST_STEP)} disabled={rest >= MAX_REST_SEC} />
      </View>

      <View style={styles.tableHead}>
        <AppText variant="label" muted style={styles.colType}>
          {t('editor.col.set')}
        </AppText>
        <AppText variant="label" muted style={styles.colNumber}>
          {t('editor.col.kg')}
        </AppText>
        <AppText variant="label" muted style={styles.colNumber}>
          {timed ? t('editor.col.seconds') : t('editor.col.reps')}
        </AppText>
        <View style={styles.colRemove} />
      </View>

      {exercise.sets.map((set, setIndex) => {
        const special = set.type !== 'normal';
        return (
          <View key={setIndex} style={styles.setRow}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('editor.setTypeLabel', { name, number: setIndex + 1 })}
              onPress={() => onSetType(setIndex)}
              scaleTo={0.94}
              style={[styles.colType, styles.typeButton, { backgroundColor: special ? colors.primary : colors.muted, borderRadius: radius.control }]}>
              <AppText variant="bodyStrong" color={special ? colors.primaryForeground : colors.foreground}>
                {labels[setIndex]}
              </AppText>
            </PressableScale>
            <NumberCell
              value={set.weightKg}
              max={MAX_WEIGHT_KG}
              decimals={1}
              keyboard="decimal-pad"
              label={t('editor.weightLabel', { name, number: setIndex + 1 })}
              onChange={(weightKg) => onSetPatch(setIndex, { weightKg })}
            />
            {timed ? (
              <NumberCell
                value={set.seconds}
                max={MAX_SECONDS}
                decimals={0}
                keyboard="number-pad"
                label={t('editor.secondsLabel', { name, number: setIndex + 1 })}
                onChange={(seconds) => onSetPatch(setIndex, { seconds, reps: null })}
              />
            ) : (
              <NumberCell
                value={set.reps}
                max={MAX_REPS}
                decimals={0}
                keyboard="number-pad"
                label={t('editor.repsLabel', { name, number: setIndex + 1 })}
                onChange={(reps) => onSetPatch(setIndex, { reps, seconds: null })}
              />
            )}
            <IconAction icon="close" label={t('editor.removeSet', { name, number: setIndex + 1 })} onPress={() => onRemoveSet(setIndex)} />
          </View>
        );
      })}

      <Button label={t('editor.addSet')} icon="add" onPress={onAddSet} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  headText: { flex: 1, gap: 0 },
  restRow: { flexDirection: 'row', alignItems: 'center' },
  restText: { flex: 1, gap: 1 },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  colType: { width: 44 },
  colNumber: { flex: 1, textAlign: 'center' },
  colRemove: { width: HIT },
  typeButton: { height: 40, alignItems: 'center', justifyContent: 'center' },
  cell: { flex: 1 },
  number: { textAlign: 'center' },
});
