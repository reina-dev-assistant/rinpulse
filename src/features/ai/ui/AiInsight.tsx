import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconChip } from '@/components/IconChip';
import { FadeIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Card, Divider } from '@/components/Screen';
import type { CoachState } from '@/features/coach/useCoach';
import { useCoach } from '@/features/coach/useCoach';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { fmtInt } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { spacing, useColors } from '@/theme';
import { todaysInsight } from '../engine';
import { useAiSettings, useByokAccess } from '../hooks';
import type { InsightKind } from '../insight';
import { INSIGHT_TOKENS, modelShort } from './status';

interface InsightProps {
  coach: CoachState;
  model: string;
  /** `inline` sits inside a card under its headline; `card` is its own small card. */
  layout: 'inline' | 'card';
}

/**
 * The opt-in summary on the Coach card: asked once when the card shows (the answer is cached per day, per Monday for the weekly one),
 * nothing while it loads or when there is none, so the rules-based suggestion stays the card. Expands in place; regenerating asks first
 * because it spends the person's tokens.
 */
function Insight({ coach, model, layout }: InsightProps) {
  const { t } = useTranslation('ai');
  const colors = useColors();
  const db = useSQLiteContext();
  const { signedIn } = useCloud();
  const settings = useAiSettings();
  const coachRef = useRef(coach);
  useEffect(() => {
    coachRef.current = coach;
  });
  const [result, setResult] = useState<{ kind: InsightKind; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenFailed, setRegenFailed] = useState(false);
  const regenCtl = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    let cancelled = false;
    todaysInsight({ db, coach: coachRef.current, signedIn, signal: ctl.signal })
      .then((found) => {
        if (!cancelled) setResult(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [coach.today, db, signedIn, settings.insightDaily, settings.insightWeekly]);

  useEffect(() => () => regenCtl.current?.abort(), []);

  const regenerate = async () => {
    setConfirm(false);
    setRegenerating(true);
    setRegenFailed(false);
    const ctl = new AbortController();
    regenCtl.current = ctl;
    try {
      const found = await todaysInsight({ db, coach: coachRef.current, signedIn, force: true, signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (found) setResult(found);
      else setRegenFailed(true);
    } catch {
      if (!ctl.signal.aborted) setRegenFailed(true);
    } finally {
      if (!ctl.signal.aborted) setRegenerating(false);
    }
  };

  if (!result) return null;
  const label = result.kind === 'weekly' ? t('insight.weekly') : t('insight.daily');
  const body = (
    <View style={styles.wrap}>
      {layout === 'inline' ? <Divider /> : null}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        scaleTo={0.99}
        style={styles.header}>
        <IconChip icon="newspaper" tint="link" size="sm" />
        <AppText variant="bodyStrong" style={styles.title}>
          {label}
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
      </PressableScale>
      {open ? (
        <View style={styles.open}>
          <AppText variant="body" selectable>
            {result.text}
          </AppText>
          <AppText variant="caption" muted>
            {t('insight.by', { model: modelShort(model) })}
          </AppText>
          {regenFailed ? (
            <AppText variant="caption" danger accessibilityLiveRegion="polite">
              {t('insight.regenFailed')}
            </AppText>
          ) : null}
          <Button label={t('insight.regen')} variant="ghost" icon="refresh" loading={regenerating} onPress={() => setConfirm(true)} />
        </View>
      ) : null}
      <ConfirmDialog
        visible={confirm}
        title={t('insight.regenTitle')}
        message={t('insight.regenMessage', { tokens: fmtInt(INSIGHT_TOKENS[result.kind]) })}
        confirmLabel={t('insight.regen')}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void regenerate()}
      />
    </View>
  );
  return layout === 'card' ? (
    <FadeIn>
      <Card>{body}</Card>
    </FadeIn>
  ) : (
    body
  );
}

/** Gate: nothing below runs unless an insight switch is on and the own key is usable now. */
function Enabled({ children }: { children: (model: string) => React.ReactNode }) {
  const { access } = useByokAccess();
  return access?.ok ? <>{children(access.model)}</> : null;
}

/** Inside the Pro Coach card, under the headline. */
export function AiInsightInline({ coach }: { coach: CoachState }) {
  const settings = useAiSettings();
  if (!settings.insightDaily && !settings.insightWeekly) return null;
  return <Enabled>{(model) => <Insight coach={coach} model={model} layout="inline" />}</Enabled>;
}

function WithOwnCoach({ dataVersion, availability, model }: { dataVersion: number; availability: NightHrvAvailability | null; model: string }) {
  const coach = useCoach(dataVersion, availability);
  return coach ? <Insight coach={coach} model={model} layout="card" /> : null;
}

/** Its own small card above the sign-in or upgrade card, for accounts that do not see the Coach card. */
export function AiInsightStandalone({ dataVersion, availability }: { dataVersion: number; availability: NightHrvAvailability | null }) {
  const settings = useAiSettings();
  if (!settings.insightDaily && !settings.insightWeekly) return null;
  return <Enabled>{(model) => <WithOwnCoach dataVersion={dataVersion} availability={availability} model={model} />}</Enabled>;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
  open: { gap: spacing.sm },
});
