import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Metric } from '@/components/Metric';
import { Divider, Screen, Section } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { listAllSleep, listSleepScores, listStepSamplesSince } from '@/db/queries';
import { HourlyStages } from '@/features/sleep/HourlyStages';
import { Hypnogram } from '@/features/sleep/Hypnogram';
import { NoStagesNotice } from '@/features/sleep/NoStagesNotice';
import { buildNights, hourlyStages, NIGHT_STAGES, nightHasStages, sleepByDay, type Night } from '@/features/sleep/nights';
import { SleepScoreRing } from '@/features/sleep/SleepScoreRing';
import { STAGE_LABELS, stageColor } from '@/features/sleep/stageStyle';
import { sleepNeedSec } from '@/features/today/readiness';
import { startOfLocalDay } from '@/features/today/stats';
import { dailyStrain } from '@/features/today/strain';
import { userMaxHr } from '@/features/hrzones/settings';
import { errorMessage, formatClock, formatDuration } from '@/format';
import { fmtDate, fmtDecimal, fmtInt, useTranslation } from '@/i18n';
import { Paragraphs } from '@/features/fitness/Paragraphs';
import { useNightRoom } from '@/features/thermometer/useNightRoom';
import { AskJoyoAction } from '@/features/ai/ui/AskJoyoButton';
import { ShareSleepButton } from '@/features/stickers/ui/ShareSleepButton';
import { useWatch } from '@/state/WatchProvider';
import { HIT, radius, spacing, useColors, useTheme } from '@/theme';

/** Stage changes listed before "Show all"; a night has 30 to 60. */
const CHANGES_PREVIEW = 8;
/** Nights in the "Earlier nights" list. */
const HISTORY_ROWS = 14;

/** One night at a time: stages over the night, minutes per stage per hour, every stage change, and earlier nights. */
export function SleepScreen() {
  const { t } = useTranslation('health');
  const db = useSQLiteContext();
  const theme = useTheme();
  const colors = theme.colors;
  const { linkState, device, dataVersion, sync } = useWatch();
  const [nights, setNights] = useState<Night[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showAllChanges, setShowAllChanges] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([listAllSleep(db), listSleepScores(db)]).then(
        ([segments, scores]) => {
          if (!cancelled) {
            setNights(buildNights(segments, scores));
            setError(null);
          }
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  // Newest first; a selection that disappeared (data re-synced) falls back to the newest night.
  const index = Math.max(0, nights?.findIndex((n) => n.start === selected) ?? 0);
  const night = nights?.[index] ?? null;
  const hours = useMemo(() => (night ? hourlyStages(night) : []), [night]);
  const need = useNightNeed(night && !night.nap ? night.start : null);
  const room = useNightRoom(night);
  // The need is met by the whole wake day, naps included.
  const daySleep = useMemo(() => (night && nights ? (sleepByDay(nights).get(startOfLocalDay(night.end)) ?? null) : null), [nights, night]);
  const dayAsleepSec = night && !night.nap && daySleep ? daySleep.asleepSeconds : (night?.asleepSeconds ?? 0);
  const dayNapSec = night && !night.nap && daySleep ? daySleep.napSeconds : 0;
  // Asleep seconds of the (up to) 14 nights before the selected one, for the sticker's "vs your average".
  const recentAsleepSec = useMemo(
    () =>
      night && nights
        ? nights
            .filter((n) => !n.nap && n.start < night.start)
            .slice(0, HISTORY_ROWS)
            .map((n) => n.asleepSeconds)
        : [],
    [nights, night],
  );

  const select = (next: Night) => {
    setSelected(next.start);
    setShowAllChanges(false);
  };

  const canSync = linkState === 'connected' && device !== null;
  const refresh = { refreshing: linkState === 'syncing', onRefresh: () => void sync(), enabled: canSync };

  if (error !== null || nights === null || night === null) {
    return (
      <Screen refresh={refresh}>
        <HiddenTabHeader title={t('sleep.title')} />
        {error !== null ? (
          <Notice tone="danger">{t('sleep.error', { error })}</Notice>
        ) : nights === null ? (
          <>
            <Skeleton width="100%" height={88} radius="card" />
            <Skeleton width="100%" height={220} radius="card" />
          </>
        ) : (
          <EmptyState icon="moon" title={t('sleep.emptyTitle')} description={t('sleep.emptyDescription')} />
        )}
      </Screen>
    );
  }

  const changes = night.periods.slice(1).map((p, i) => ({ at: p.start, from: night.periods[i].stage, to: p.stage, gap: p.start - night.periods[i].end }));
  const shownPeriods = showAllChanges ? night.periods : night.periods.slice(0, CHANGES_PREVIEW);
  const stages = NIGHT_STAGES.filter((stage) => night.seconds[stage] > 0);
  const hasStages = nightHasStages(night);
  const recorded = night.asleepSeconds + night.seconds.awake;
  const minutes = Math.round(night.asleepSeconds / 60);
  const changeLine = (i: number, stage: Night['periods'][number]['stage'], prev: Night['periods'][number]['stage'] | null, gap: number) => {
    const line = prev === null ? t('sleep.changeStart', { stage: STAGE_LABELS[stage] }) : t('sleep.changeTo', { from: STAGE_LABELS[prev], to: STAGE_LABELS[stage] });
    return i > 0 && gap > 0 ? t('sleep.changeWithGap', { line, duration: formatDuration(gap) }) : line;
  };
  const historyA11y = (n: Night) => {
    const base = t(n.nap ? 'sleep.historyA11yNap' : 'sleep.historyA11yNight', { date: fmtDate(n.end, 'long'), duration: formatDuration(n.asleepSeconds) });
    return n.score ? t('sleep.historyA11yScore', { base, score: fmtInt(n.score.score) }) : base;
  };
  const dateLabel = fmtDate(night.end, 'weekday');
  const roomValues = room
    ? {
        temp: fmtDecimal(room.tempCMean, 1),
        tempMin: fmtDecimal(room.tempCMin, 1),
        tempMax: fmtDecimal(room.tempCMax, 1),
        rh: fmtDecimal(room.rhPctMean, 1),
        rhMin: fmtDecimal(room.rhPctMin, 1),
        rhMax: fmtDecimal(room.rhPctMax, 1),
      }
    : null;

  return (
    <Screen refresh={refresh}>
      <HiddenTabHeader title={t('sleep.title')} />

      <View style={styles.picker}>
        <StepButton
          icon="chevron-back"
          label={t('sleep.earlierNight')}
          disabled={index >= nights.length - 1}
          onPress={() => select(nights[index + 1])}
        />
        <View style={styles.pickerText} accessibilityLiveRegion="polite">
          <AppText variant="heading" numberOfLines={1}>
            {dateLabel}
          </AppText>
          <AppText variant="caption" muted>
            {t(night.nap ? 'sleep.periodNap' : 'sleep.periodNight', { from: formatClock(night.start), to: formatClock(night.end) })}
          </AppText>
        </View>
        <StepButton icon="chevron-forward" label={t('sleep.laterNight')} disabled={index === 0} onPress={() => select(nights[index - 1])} />
      </View>

      <ShareSleepButton night={night} recentAsleepSec={recentAsleepSec} />
      <AskJoyoAction seed={{ seed: 'sleep', ref: night.day, label: dateLabel }} />

      <Section title={night.nap ? t('sleep.sectionNap') : t('sleep.sectionNight')} icon="moon" tint="sleep">
        <View style={styles.headlineRow}>
          <View accessible accessibilityLabel={t('sleep.asleepA11y', { duration: formatDuration(night.asleepSeconds) })} style={styles.headline}>
            {minutes >= 60 ? <Metric value={String(Math.floor(minutes / 60))} unit={t('sleep.hoursUnit')} size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} /> : null}
            <Metric value={String(minutes % 60).padStart(minutes >= 60 ? 2 : 1, '0')} unit={t('sleep.minutesUnit')} size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} />
          </View>
          {night.score ? <SleepScoreRing score={night.score} /> : null}
        </View>
        <AppText variant="caption" muted>
          {[
            night.estimated ? t('sleep.stageEstimate') : null,
            hasStages ? t('sleep.stageSummary', { awakenings: night.awakenings, count: changes.length }) : t('sleep.noStages'),
            dayNapSec > 0 ? t('sleep.napsIncluded', { duration: formatDuration(dayNapSec) }) : null,
            need ? t('sleep.needSummary', { need: formatDuration(need.seconds), percent: Math.round((dayAsleepSec / need.seconds) * 100) }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
        <View style={styles.legend}>
          {stages.map((stage) => (
            <View key={stage} style={styles.legendRow}>
              <View style={[styles.swatch, { backgroundColor: stageColor(stage, colors) }]} />
              <AppText variant="caption" numberOfLines={1} style={styles.legendLabel}>
                {STAGE_LABELS[stage]}
              </AppText>
              <AppText variant="label" style={styles.tabular}>
                {formatDuration(night.seconds[stage])}{' '}
                <AppText variant="caption" muted>
                  {Math.round((night.seconds[stage] / recorded) * 100)}%
                </AppText>
              </AppText>
            </View>
          ))}
        </View>
        {roomValues ? (
          <View style={styles.roomRow} accessible accessibilityLabel={t('sleep.roomA11y', roomValues)}>
            <Ionicons name="thermometer-outline" size={16} color={colors.mutedForeground} />
            <AppText variant="caption" muted style={styles.roomText}>
              {t('sleep.room', roomValues)}
            </AppText>
          </View>
        ) : null}
        {!hasStages && !night.nap ? <NoStagesNotice /> : null}
        <Details title={t('sleep.detailsTitle')}>
          <Paragraphs
            lines={[
              t('sleep.detailsAsleep'),
              ...(night.score
                ? [night.score.efficiency !== null ? t('sleep.detailsScoreEfficiency', { efficiency: night.score.efficiency }) : t('sleep.detailsScore')]
                : []),
              ...(need ? [need.strain !== null ? t('sleep.detailsNeedStrain', { strain: fmtDecimal(need.strain, 1) }) : t('sleep.detailsNeed')] : []),
              ...(need && dayNapSec > 0 ? [t('sleep.detailsNaps')] : []),
            ]}
          />
        </Details>
      </Section>

      <Section title={t('sleep.stages')} icon="analytics" tint="sleep">
        <Hypnogram night={night} />
      </Section>

      <Section title={t('sleep.eachHour')} icon="bar-chart" tint="sleep">
        <HourlyStages hours={hours} />
        <Details title={t('sleep.detailsTitle')}>{t('sleep.eachHourNote')}</Details>
      </Section>

      <Section title={t('sleep.stageChanges')} icon="swap-vertical" tint="sleep" trailing={<AppText variant="caption" muted>{changes.length}</AppText>}>
        {shownPeriods.map((p, i) => (
          <View key={p.start}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.changeRow}>
              <AppText variant="label" style={[styles.changeTime, styles.tabular]}>
                {formatClock(p.start)}
              </AppText>
              <View style={[styles.swatch, { backgroundColor: stageColor(p.stage, colors) }]} />
              <AppText variant="body" style={styles.changeStage}>
                {changeLine(i, p.stage, i > 0 ? night.periods[i - 1].stage : null, i > 0 ? changes[i - 1].gap : 0)}
              </AppText>
              <AppText variant="caption" muted style={styles.tabular}>
                {formatDuration(p.end - p.start)}
              </AppText>
            </View>
          </View>
        ))}
        {night.periods.length > CHANGES_PREVIEW ? (
          <Button
            label={showAllChanges ? t('sleep.showFewer') : t('sleep.showAll', { total: night.periods.length })}
            variant="ghost"
            onPress={() => setShowAllChanges((v) => !v)}
          />
        ) : null}
      </Section>

      <Section title={t('sleep.earlierNights')} icon="calendar" tint="sleep">
        {nights.slice(0, HISTORY_ROWS).map((n, i) => {
          const current = n.start === night.start;
          return (
            <View key={n.start}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                accessibilityLabel={historyA11y(n)}
                onPress={() => select(n)}
                style={[styles.historyRow, { borderRadius: theme.radius.input }, current && { backgroundColor: colors.sleepSoft }]}>
                <View style={styles.historyText}>
                  <AppText variant={current ? 'bodyStrong' : 'body'} numberOfLines={1}>
                    {n.nap ? t('sleep.historyNap', { date: fmtDate(n.end, 'weekday') }) : fmtDate(n.end, 'weekday')}
                  </AppText>
                  <View style={styles.miniBar}>
                    {NIGHT_STAGES.filter((s) => n.seconds[s] > 0).map((s) => (
                      <View key={s} style={{ flex: n.seconds[s], backgroundColor: stageColor(s, colors) }} />
                    ))}
                  </View>
                </View>
                {n.score ? (
                  <AppText variant="caption" color={colors.sleepText} style={styles.tabular}>
                    {fmtInt(n.score.score)}
                  </AppText>
                ) : null}
                <AppText variant="label" style={[styles.tabular, styles.historyDuration]}>
                  {formatDuration(n.asleepSeconds)}
                </AppText>
              </Pressable>
            </View>
          );
        })}
      </Section>
    </Screen>
  );
}

/**
 * The sleep a night needed: 7 h 30 min plus up to 1 h after the strain of the day it started on (see `readiness.ts`).
 * `strain` is null when that day has no stored heart rate; the base need still applies.
 */
function useNightNeed(nightStart: number | null): { seconds: number; strain: number | null } | null {
  const db = useSQLiteContext();
  const [need, setNeed] = useState<{ start: number; seconds: number; strain: number | null } | null>(null);
  useEffect(() => {
    if (nightStart === null) return;
    let cancelled = false;
    // A night that starts after midnight belongs to the day before it.
    const day = startOfLocalDay(nightStart - 6 * 3600);
    void listStepSamplesSince(db, day).then((samples) => {
      if (cancelled) return;
      const strain = dailyStrain(samples.filter((s) => s.timestamp < nightStart), userMaxHr()).find((d) => d.day === day)?.strain ?? null;
      setNeed({ start: nightStart, seconds: sleepNeedSec(strain), strain });
    });
    return () => {
      cancelled = true;
    };
  }, [db, nightStart]);
  return need && need.start === nightStart ? need : null;
}

function StepButton({ icon, label, disabled, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; disabled: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, { backgroundColor: colors.card, opacity: disabled ? 0.4 : 1 }]}>
      <Ionicons name={icon} size={22} color={colors.foreground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  picker: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pickerText: { flex: 1, alignItems: 'center', gap: 2 },
  step: { width: HIT, height: HIT, borderRadius: HIT / 2, alignItems: 'center', justifyContent: 'center' },
  headlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  legend: { gap: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { flex: 1 },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roomText: { flex: 1, fontVariant: ['tabular-nums'] },
  tabular: { fontVariant: ['tabular-nums'] },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 34 },
  changeTime: { width: 48 },
  changeStage: { flex: 1 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44, paddingHorizontal: spacing.sm, marginHorizontal: -spacing.sm },
  historyText: { flex: 1, gap: 4 },
  historyDuration: { minWidth: 76, textAlign: 'right' },
  miniBar: { flexDirection: 'row', height: 6, gap: 1, borderRadius: radius.pill, overflow: 'hidden' },
});
