import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useAppleHealthImport } from '@/features/settings/useAppleHealthImport';
import { formatCount, formatDateTime } from '@/format';
import { radius, useColors } from '@/theme';
import type { HuaweiImportSummary } from '@/wear';

/**
 * One-time import of the history Huawei Health saved into Apple Health (iOS). JoyoFit reads Apple Health only here, only
 * after you tap the button, and nothing leaves the phone. Samples JoyoFit wrote itself are skipped. Imported days stay on
 * the phone: they are not uploaded, written back to Apple Health or sent to Strava.
 */
export function AppleHealthImportSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { running, progress, summary, error, start, cancel } = useAppleHealthImport();

  return (
    <>
      <Section title={t('appleImport.title')} leading={<BrandMark brand="apple-health" size={32} />}>
        <AppText variant="caption" muted>
          {t('appleImport.intro')}
        </AppText>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {running ? (
          <>
            <ProgressBar fraction={progress?.fraction ?? 0} />
            <AppText variant="caption" muted>
              {progress
                ? t('appleImport.reading', { percent: Math.round(progress.fraction * 100) })
                : t('appleImport.waiting')}
            </AppText>
            {progress ? <Counts summary={progress.summary} /> : null}
            <Button label={t('common:actions.cancel')} variant="secondary" icon="close" onPress={cancel} />
          </>
        ) : (
          <Button label={t('appleImport.title')} variant="primary" icon="heart" onPress={() => void start()} />
        )}
        <AppText variant="caption" muted>
          {t('appleImport.footer')}
        </AppText>
      </Section>

      {summary ? <Summary summary={summary} /> : null}
    </>
  );
}

function ProgressBar({ fraction }: { fraction: number }) {
  const colors = useColors();
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { backgroundColor: colors.muted }]}>
      <View style={[styles.fill, { backgroundColor: colors.primary, width: `${percent}%` }]} />
    </View>
  );
}

function Counts({ summary }: { summary: HuaweiImportSummary }) {
  const { t } = useTranslation(['settings', 'common']);
  return (
    <>
      <KeyValue label={t('appleImport.workoutsAdded')} value={formatCount(summary.workoutsAdded)} />
      <KeyValue label={t('appleImport.heartRate')} value={formatCount(summary.heartRateReadings)} />
      <KeyValue label={t('appleImport.sleepFound')} value={formatCount(summary.sleepSegmentsFound)} />
    </>
  );
}

function Summary({ summary }: { summary: HuaweiImportSummary }) {
  const { t } = useTranslation(['settings', 'common']);
  const range =
    summary.oldestSec !== null && summary.newestSec !== null
      ? t('appleImport.range', { from: formatDateTime(summary.oldestSec), to: formatDateTime(summary.newestSec) })
      : null;
  const empty = summary.oldestSec === null;
  const skippedWorkouts = summary.workoutsFound - summary.workoutsAdded;
  const skippedSleep = summary.sleepSegmentsFound - summary.sleepSegmentsAdded;
  return (
    <Section title={summary.cancelled ? t('appleImport.stopped') : t('appleImport.finished')} icon="checkmark-circle" tint="heart">
      {summary.cancelled ? (
        <Notice icon="information-circle">
          {t('appleImport.stoppedNotice')}
        </Notice>
      ) : null}
      {empty && !summary.cancelled ? (
        <Notice icon="information-circle">
          {t('appleImport.nothing')}
        </Notice>
      ) : null}
      <KeyValue icon="calendar" label={t('appleImport.historyRead')} value={range} />
      <KeyValue icon="barbell" label={t('appleImport.workoutsAdded')} value={formatCount(summary.workoutsAdded)} />
      <KeyValue icon="moon" label={t('appleImport.sleepAdded')} value={formatCount(summary.sleepSegmentsAdded)} />
      <KeyValue icon="heart" label={t('appleImport.heartRate')} value={formatCount(summary.heartRateReadings)} />
      <KeyValue label={t('appleImport.restingHr')} value={formatCount(summary.restingHeartRateReadings)} />
      <KeyValue label={t('appleImport.spo2')} value={formatCount(summary.spo2Readings)} />
      <KeyValue icon="footsteps" label={t('appleImport.minutes')} value={formatCount(summary.minutesWritten)} />
      {skippedWorkouts > 0 ? (
        <KeyValue label={t('appleImport.alreadyOnPhone')} value={formatCount(skippedWorkouts)} />
      ) : null}
      {skippedSleep > 0 ? (
        <KeyValue label={t('appleImport.sleepSkipped')} value={formatCount(skippedSleep)} />
      ) : null}
      {summary.rejectedSamples > 0 ? (
        <KeyValue label={t('appleImport.implausible')} value={formatCount(summary.rejectedSamples)} />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
});
