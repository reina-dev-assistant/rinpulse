import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { fontSize, spacing, tintColors, useColors } from '@/theme';

import type { SetPatch } from '../draft';
import { inputText, previousLabel, rpeText, SET_BADGE, type PreviousSet } from '../logFormat';
import type { SetType, StrengthSet } from '../types';
import { NumberField } from './NumberField';

/** Column widths shared by the header and the rows of a set table. */
export const COLUMN = { set: 44, rpe: 56, check: 44 } as const;

export interface SetRowActions {
  onChange: (exerciseKey: string, setId: string, patch: SetPatch) => void;
  onToggle: (exerciseKey: string, setId: string) => void;
  onMenu: (exerciseKey: string, setId: string) => void;
  onFillPrevious: (exerciseKey: string, setId: string) => void;
  onPickRpe: (exerciseKey: string, setId: string) => void;
}

interface SetRowProps {
  exerciseKey: string;
  set: StrengthSet;
  label: string;
  previous: PreviousSet | null;
  timed: boolean;
  showRpe: boolean;
  /** Bumps when this row's tick was refused. */
  flash: number;
  actions: SetRowActions;
}

/** The colour of the badge of a set type. */
export function useTypeColor(type: SetType): string {
  const colors = useColors();
  switch (type) {
    case 'warmup':
      return colors.warning;
    case 'drop':
      return tintColors(colors, 'link').text;
    case 'failure':
      return colors.destructive;
    default:
      return colors.mutedForeground;
  }
}

function SetRowView({ exerciseKey, set, label, previous, timed, showRpe, flash, actions }: SetRowProps) {
  const { t } = useTranslation('strength');
  const colors = useColors();
  const typeColor = useTypeColor(set.type);
  const badge = SET_BADGE[set.type];
  const prev = previous ? previousLabel(previous, timed) : null;
  const hintOf = (n: number | null): string | undefined => (set.done || n === null ? undefined : inputText(n));

  const typeName = t(`setType.${set.type}`);
  return (
    <View style={[styles.row, set.done && { backgroundColor: colors.workoutsSoft }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('table.setLabel', { label, type: typeName })}
        onPress={() => actions.onMenu(exerciseKey, set.id)}
        scaleTo={0.92}
        style={[styles.setCell, { width: COLUMN.set }]}>
        <AppText variant="bodyStrong" color={set.type === 'normal' ? colors.foreground : typeColor}>
          {label}
        </AppText>
        {badge && (set.type === 'drop' || set.type === 'failure') ? (
          <AppText variant="label" color={typeColor} style={styles.badge}>
            {t(`setTypeShort.${set.type}`)}
          </AppText>
        ) : null}
      </PressableScale>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={prev ? t('table.usePrevious', { value: prev }) : t('table.noPrevious')}
        disabled={!prev}
        onPress={() => actions.onFillPrevious(exerciseKey, set.id)}
        scaleTo={0.96}
        style={styles.previous}>
        <AppText variant="caption" muted numberOfLines={1}>
          {prev ?? t('table.dash')}
        </AppText>
      </PressableScale>

      <NumberField
        kind="weight"
        value={set.weightKg}
        hint={hintOf(previous?.weightKg ?? null)}
        label={t('table.weightField', { label })}
        done={set.done}
        flash={0}
        onChange={(weightKg) => actions.onChange(exerciseKey, set.id, { weightKg })}
        style={styles.field}
      />
      {timed ? (
        <NumberField
          kind="seconds"
          value={set.seconds}
          hint={hintOf(previous?.seconds ?? null)}
          label={t('table.secondsField', { label })}
          done={set.done}
          flash={flash}
          onChange={(seconds) => actions.onChange(exerciseKey, set.id, { seconds })}
          style={styles.field}
        />
      ) : (
        <NumberField
          kind="reps"
          value={set.reps}
          hint={hintOf(previous?.reps ?? null)}
          label={t('table.repsField', { label })}
          done={set.done}
          flash={flash}
          onChange={(reps) => actions.onChange(exerciseKey, set.id, { reps })}
          style={styles.field}
        />
      )}

      {showRpe ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('table.rpeField', { label })}
          onPress={() => actions.onPickRpe(exerciseKey, set.id)}
          scaleTo={0.94}
          style={[styles.rpe, { width: COLUMN.rpe, backgroundColor: colors.muted }]}>
          <AppText variant="bodyStrong" muted={set.rpe === null}>
            {set.rpe === null ? t('table.dash') : rpeText(set.rpe)}
          </AppText>
        </PressableScale>
      ) : null}

      <PressableScale
        accessibilityRole="checkbox"
        accessibilityLabel={t('table.doneField', { label })}
        accessibilityState={{ checked: set.done }}
        onPress={() => actions.onToggle(exerciseKey, set.id)}
        scaleTo={0.9}
        style={[styles.check, { width: COLUMN.check, backgroundColor: set.done ? colors.primary : colors.muted }]}>
        <Ionicons name="checkmark" size={22} color={set.done ? colors.primaryForeground : colors.mutedForeground} />
      </PressableScale>
    </View>
  );
}

export const SetRow = memo(SetRowView);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, paddingHorizontal: spacing.xs, borderRadius: 12 },
  setCell: { height: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 1 },
  badge: { fontSize: fontSize.xs, lineHeight: 14 },
  previous: { flex: 1.3, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, minWidth: 0 },
  rpe: { height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  check: { height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
