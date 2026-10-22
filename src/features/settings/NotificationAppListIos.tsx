import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Chip } from '@/components/Chip';
import { Details } from '@/components/Details';
import { Screen, Section } from '@/components/Screen';
import { EmptyState, Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { ATUR_REPORTS_ENABLED } from '@/features/device/aturConfig';
import { AturReportForm } from '@/features/device/AturReportForm';
import {
  DEFAULT_TEST_APP,
  isTestRunning,
  OTHER_APP,
  rowEnabled,
  testableApps,
  testBlock,
} from '@/features/settings/notificationFilter';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';
import { hasNative, HuaweiWear, type NotificationFilterEncoding, type NotificationFilterStatus } from '@/wear';

/**
 * Per-app notification switches on iPhone. The watch filters on the app id iOS gives it, but which id string it matches and which byte means "off"
 * is not known for an iPhone, so the switches stay disabled until the filter test found it out on this watch (`NotificationAppFilter.swift`,
 * docs/ios.md). A build from before the native part has none of this: the old explanation shows.
 */
export function NotificationAppListIos() {
  const { t } = useTranslation('settings');
  if (!hasNative('getNotificationFilter')) {
    return <EmptyState icon="apps" title={t('notifApps.iosTitle')} description={t('notifApps.iosDesc')} />;
  }
  return <NotificationFilterScreen />;
}

function NotificationFilterScreen() {
  const { t } = useTranslation('settings');
  const { linkState } = useWatch();
  const [tick, setTick] = useState(0);
  const [testApp, setTestApp] = useState(DEFAULT_TEST_APP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useNativeRefresh(refresh);
  // Read again after every call of ours, when the screen gains focus or the app returns, and when the link changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` and `linkState` are the triggers, the native read has no inputs
  const status = useMemo(() => HuaweiWear.getNotificationFilter(), [tick, linkState]);

  // Leaving the screen ends a running test: the app under test goes back on. The native side does the same when the app goes to the background.
  const running = isTestRunning(status);
  const runningNow = useRef(running);
  useEffect(() => {
    runningNow.current = running;
  }, [running]);
  useFocusEffect(
    useCallback(
      () => () => {
        if (runningNow.current) void HuaweiWear.cancelNotificationFilterTest().catch(() => undefined);
      },
      [],
    ),
  );

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const labelOf = (packageName: string) => status.apps.find((app) => app.packageName === packageName)?.label ?? packageName;
  const how: Record<NotificationFilterEncoding, string> = {
    A: t('notifApps.ios.encoding.a'),
    B: t('notifApps.ios.encoding.b'),
    C1: t('notifApps.ios.encoding.c1'),
    C2: t('notifApps.ios.encoding.c2'),
  };
  /** Why a row's switch is off, or that it is sent later; nothing when it just works. */
  const hintFor = (app: (typeof status.apps)[number]) => {
    if (status.encoding === null) return t('notifApps.ios.rowHint.unproven');
    if (!app.sendable) return t('notifApps.ios.rowHint.noId');
    if (app.packageName === OTHER_APP) return t('notifApps.ios.rowHint.other');
    if (!status.connected) return t('notifApps.ios.rowHint.offline');
    return undefined;
  };
  const test = status.test;

  return (
    <Screen>
      <Notice icon="information-circle">{t('notifApps.ios.intro')}</Notice>

      <Section title={t('notifApps.ios.filterTitle')} icon="flask">
        {status.encoding ? (
          <Notice icon="checkmark-circle">{t('notifApps.ios.proven', { how: how[status.encoding] })}</Notice>
        ) : (
          <AppText variant="caption" muted>
            {t('notifApps.ios.unproven')}
          </AppText>
        )}
        {status.restorePending && !running ? <Notice icon="alert-circle">{t('notifApps.ios.restorePending')}</Notice> : null}
        {test && test.phase === 'probe' ? (
          <AppText>
            {t('notifApps.ios.probe', { step: test.step, steps: test.steps, app: labelOf(test.app) })}
          </AppText>
        ) : null}
        {test && test.phase === 'confirm' ? <AppText>{t('notifApps.ios.confirm', { app: labelOf(test.app) })}</AppText> : null}
        {test && test.phase === 'finished' && test.outcome ? (
          <FinishedTest
            how={test.candidate ? how[test.candidate] : ''}
            app={labelOf(test.app)}
            outcome={test.outcome}
            report={test.report}
            reporting={reporting}
            onReport={() => setReporting(true)}
            onCloseReport={() => setReporting(false)}
          />
        ) : null}

        {test && test.phase === 'probe' ? (
          <ButtonRow>
            <Button label={t('notifApps.ios.stillShown')} variant="primary" onPress={() => void run(() => HuaweiWear.answerNotificationFilterTest(true))} disabled={busy} />
            <Button label={t('notifApps.ios.hidden')} variant="primary" onPress={() => void run(() => HuaweiWear.answerNotificationFilterTest(false))} disabled={busy} />
          </ButtonRow>
        ) : null}
        {test && test.phase === 'confirm' ? (
          <ButtonRow>
            <Button label={t('notifApps.ios.confirmYes')} variant="primary" onPress={() => void run(() => HuaweiWear.answerNotificationFilterTest(true))} disabled={busy} />
            <Button label={t('notifApps.ios.confirmNo')} variant="primary" onPress={() => void run(() => HuaweiWear.answerNotificationFilterTest(false))} disabled={busy} />
          </ButtonRow>
        ) : null}
        {running ? (
          <Button label={t('notifApps.ios.cancel')} variant="ghost" onPress={() => void run(() => HuaweiWear.cancelNotificationFilterTest())} disabled={busy} />
        ) : (
          <TestStarter
            status={status}
            testApp={testApp}
            onPick={setTestApp}
            busy={busy}
            onStart={() => {
              setReporting(false);
              void run(() => HuaweiWear.startNotificationFilterTest(testApp));
            }}
          />
        )}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Section>

      <Section title={t('notifApps.ios.appsTitle')} icon="apps">
        {status.apps.map((app) => (
          <SwitchRow
            key={app.packageName}
            label={app.packageName === OTHER_APP ? t('notifApps.ios.other') : app.label}
            hint={hintFor(app)}
            value={app.enabled}
            onValueChange={(enabled) => void run(() => HuaweiWear.setNotificationAppEnabled(app.packageName, enabled))}
            disabled={busy || !rowEnabled(status, app)}
          />
        ))}
        <Details>{t('notifApps.ios.details')}</Details>
      </Section>
    </Screen>
  );
}

interface TestStarterProps {
  status: NotificationFilterStatus;
  testApp: string;
  onPick: (packageName: string) => void;
  busy: boolean;
  onStart: () => void;
}

/** The app to test (default Messages), what stands in the way, and the button that starts the test. */
function TestStarter({ status, testApp, onPick, busy, onStart }: TestStarterProps) {
  const { t } = useTranslation('settings');
  const block = testBlock(status);
  return (
    <View style={styles.starter}>
      <AppText variant="label" muted>
        {t('notifApps.ios.pickApp')}
      </AppText>
      <View style={styles.chips}>
        {testableApps(status).map((app) => (
          <Chip key={app.packageName} label={app.label} selected={app.packageName === testApp} onPress={() => onPick(app.packageName)} />
        ))}
      </View>
      {block === 'disconnected' ? <Notice>{t('notifApps.ios.block.disconnected')}</Notice> : null}
      {block === 'noGate' ? <Notice>{t('notifApps.ios.block.noGate')}</Notice> : null}
      {block === 'noAncs' ? <Notice>{t('notifications.ios.howTo')}</Notice> : null}
      <Button
        label={status.encoding ? t('notifApps.ios.retest') : t('notifApps.ios.start')}
        variant="primary"
        icon="flask"
        onPress={onStart}
        disabled={busy || block !== null}
      />
    </View>
  );
}

interface FinishedTestProps {
  how: string;
  app: string;
  outcome: NonNullable<NonNullable<NotificationFilterStatus['test']>['outcome']>;
  report: string | null;
  reporting: boolean;
  onReport: () => void;
  onCloseReport: () => void;
}

/** What the test came to, the report line that went to the support log, and a way to send it to the team. */
function FinishedTest({ how, app, outcome, report, reporting, onReport, onCloseReport }: FinishedTestProps) {
  const { t } = useTranslation('settings');
  const text = {
    winner: t('notifApps.ios.outcome.winner', { how }),
    none: t('notifApps.ios.outcome.none', { app }),
    inconclusive: t('notifApps.ios.outcome.inconclusive', { app }),
    cancelled: t('notifApps.ios.outcome.cancelled', { app }),
    failed: t('notifApps.ios.outcome.failed', { app }),
  };
  return (
    <View style={styles.finished}>
      <Notice tone={outcome === 'failed' ? 'danger' : 'info'} icon={outcome === 'winner' ? 'checkmark-circle' : 'alert-circle'}>
        {text[outcome]}
      </Notice>
      {report ? (
        <>
          <AppText variant="caption" muted>
            {t('notifApps.ios.resultLabel')}
          </AppText>
          <AppText variant="mono" selectable>
            {report}
          </AppText>
          {ATUR_REPORTS_ENABLED && !reporting ? (
            <Button label={t('notifApps.ios.sendResult')} icon="paper-plane" onPress={onReport} />
          ) : null}
          {reporting ? <AturReportForm onClose={onCloseReport} initialMessage={report} /> : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  starter: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  finished: { gap: spacing.sm },
});
