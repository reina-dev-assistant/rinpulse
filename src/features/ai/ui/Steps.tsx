import { Ionicons } from '@expo/vector-icons';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useTheme } from '@/theme';
import type { ToolName } from '../tools';
import { runningPhrase, stepCall, stepPhrase, stepResult, type StepView } from './chatState';

const TOOL_ICON: Record<ToolName, IconName> = {
  get_daily: 'calendar-outline',
  get_trend: 'trending-up-outline',
  get_sleep_night: 'moon-outline',
  list_workouts: 'barbell-outline',
  get_workout: 'fitness-outline',
  get_nutrition: 'restaurant-outline',
  get_plan: 'clipboard-outline',
  propose_note: 'create-outline',
};

function StepRow({ step }: { step: StepView }) {
  const { t } = useTranslation('ai');
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const phrase = step.running ? runningPhrase(step, t) : stepPhrase(step, t);
  const result = step.running ? null : stepResult(step, t);
  const bad = step.failed || step.notConnected;
  const label = result ? `${phrase}, ${result}` : phrase;
  return (
    <View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        scaleTo={0.99}
        hitSlop={{ top: 2, bottom: 2 }}
        onPress={() => setOpen((v) => !v)}
        style={styles.row}>
        <Ionicons name={bad ? 'alert-circle-outline' : TOOL_ICON[step.tool]} size={16} color={bad ? colors.destructive : colors.mutedForeground} />
        <AppText variant="caption" style={styles.phrase} numberOfLines={2}>
          {phrase}
        </AppText>
        {result ? (
          <AppText variant="caption" muted={!bad} danger={bad} numberOfLines={1} style={styles.result}>
            {result}
          </AppText>
        ) : null}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.mutedForeground} />
      </PressableScale>
      {open ? (
        <View style={styles.call}>
          <AppText variant="caption" muted>
            {t('steps.call')}
          </AppText>
          <AppText variant="mono" muted selectable>
            {stepCall(step)}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The tools an answer ran, in one card above the answer text, headed by how many were read. Open while the answer is being written, folded once it
 * is done; each row opens to the exact call (tool and plain arguments, never a value read).
 */
export const StepsCard = memo(function StepsCard({ steps, defaultOpen }: { steps: readonly StepView[]; defaultOpen: boolean }) {
  const { t } = useTranslation('ai');
  const { colors, radius } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  if (steps.length === 0) return null;
  const title = t('steps.group', { count: steps.length });
  return (
    <View style={[styles.card, { backgroundColor: colors.muted, borderRadius: radius.input }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        scaleTo={0.99}
        hitSlop={{ top: 2, bottom: 2 }}
        onPress={() => setOpen((v) => !v)}
        style={styles.header}>
        <AppText variant="label" muted style={styles.phrase}>
          {title}
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.mutedForeground} />
      </PressableScale>
      {open ? (
        <View style={styles.rows}>
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

/** The model's reasoning: one muted row, closed until tapped. `live` words it as in progress ("Berpikir"), after the answer it is "Proses berpikir". */
export const ReasoningBlock = memo(function ReasoningBlock({ text, live }: { text: string; live?: boolean }) {
  const { t } = useTranslation('ai');
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const body = text.trim();
  if (body === '') return null;
  const title = live ? t('chat.thinking') : t('chat.thought');
  return (
    <View style={styles.reasoning}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        scaleTo={0.99}
        hitSlop={{ top: 4, bottom: 4 }}
        onPress={() => setOpen((v) => !v)}
        style={styles.reasoningHeader}>
        <Ionicons name="bulb-outline" size={16} color={colors.mutedForeground} />
        <AppText variant="caption" muted>
          {title}
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.mutedForeground} />
      </PressableScale>
      {open ? (
        <AppText variant="caption" muted selectable>
          {body}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  header: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rows: { paddingBottom: spacing.xs },
  row: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  phrase: { flex: 1 },
  result: { flexShrink: 0, maxWidth: '45%', textAlign: 'right' },
  call: { gap: 2, paddingLeft: 16 + spacing.sm, paddingBottom: spacing.sm },
  reasoning: { gap: spacing.xs },
  reasoningHeader: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
});
