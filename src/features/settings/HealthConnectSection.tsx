import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type HealthConnectStatus } from '@/wear';

/** The same store, by the name each platform uses. */
const STORE = isIos ? 'Apple Health' : 'Health Connect';

const AVAILABILITY_KEY = {
  available: 'healthConnect.available',
  'update-required': 'healthConnect.updateRequired',
  unavailable: 'healthConnect.unavailable',
} as const satisfies Record<HealthConnectStatus['availability'], string>;

type Busy = 'asking' | 'switchingOff' | 'writing' | 'opening';

/** Types written to Health Connect; the count shown next to the permission state. */
const RECORD_TYPE_COUNT = 8;

/**
 * Write the watch data to Health Connect so other apps (JoyoRogo, for one) can read it. The export
 * itself runs in native code after every sync, also when the app is closed; this section only
 * asks for the write permissions, flips the switch and starts the backfill.
 */
export function HealthConnectSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { dataVersion } = useWatch();
  const [status, setStatus] = useState<HealthConnectStatus | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    HuaweiWear.getHealthConnectStatus().then(setStatus, (e) => setError(errorMessage(e)));
  }, []);

  useNativeRefresh(refresh);
  // A finished sync may have exported, so re-read the last export time.
  useEffect(refresh, [refresh, dataVersion]);

  const run = async (what: Busy, action: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const toggle = (next: boolean) =>
    run(next ? 'asking' : 'switchingOff', async () => {
      if (!next) {
        setStatus(await HuaweiWear.setHealthConnectEnabled(false));
        return;
      }
      const afterRequest = await HuaweiWear.requestHealthConnectPermissions();
      if (afterRequest.granted.length === 0) {
        setError(t('healthConnect.noWrite', { store: STORE }));
        return;
      }
      setBusy('writing');
      setStatus(await HuaweiWear.setHealthConnectEnabled(true));
    });

  const unavailable = status != null && status.availability !== 'available';
  const grantedCount = status?.granted.length ?? 0;

  return (
    <Section title={STORE} leading={<BrandMark brand={isIos ? 'apple-health' : 'health-connect'} size={32} />}>
      <SwitchRow
        icon="heart"
        label={t('healthConnect.write', { store: STORE })}
        value={status?.enabled ?? false}
        onValueChange={toggle}
        disabled={busy != null || status == null || unavailable}
      />
      {busy ? (
        <AppText variant="caption" muted>
          {t(`healthConnect.busy.${busy}`)}...
        </AppText>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {status?.lastError ? <Notice tone="danger">{t('healthConnect.lastFailed', { error: status.lastError })}</Notice> : null}
      <PairGrid>
        <Pair label={STORE} value={status ? t(AVAILABILITY_KEY[status.availability], { store: STORE }) : null} />
        <Pair
          label={t('healthConnect.permission')}
          value={
            status && !unavailable
              ? t('healthConnect.permissionValue', { granted: grantedCount, total: RECORD_TYPE_COUNT })
              : null
          }
        />
        <Pair label={t('healthConnect.lastExport')} value={status?.lastExportSec ? formatDateTime(status.lastExportSec) : null} />
      </PairGrid>
      {status && status.missing.length > 0 && !unavailable && grantedCount > 0 ? (
        <AppText variant="caption" muted>
          {t('healthConnect.missing', { list: status.missing.join(', ') })}
        </AppText>
      ) : null}
      {status?.lastCounts ? (
        <AppText variant="caption" muted selectable>
          {status.lastCounts}
        </AppText>
      ) : null}
      {status ? (
        <ButtonRow>
          {!unavailable && grantedCount < RECORD_TYPE_COUNT ? (
            <Button
              label={t('healthConnect.continue')}
              variant="secondary"
              icon="add-circle-outline"
              onPress={() =>
                run('asking', async () => {
                  setStatus(await HuaweiWear.requestHealthConnectPermissions());
                })
              }
              disabled={busy != null}
            />
          ) : null}
          {status.enabled && !unavailable ? (
            <Button
              label={t('healthConnect.writeAgain')}
              variant="secondary"
              icon="refresh"
              onPress={() =>
                run('writing', async () => {
                  await HuaweiWear.backfillHealthConnect();
                })
              }
              disabled={busy != null}
              loading={busy === 'writing'}
            />
          ) : null}
          <Button
            label={t('common:actions.open')}
            variant="ghost"
            icon="open-outline"
            onPress={() => run('opening', () => HuaweiWear.openHealthConnectSettings())}
            disabled={busy != null}
          />
        </ButtonRow>
      ) : null}
      <Details>{t('healthConnect.details')}</Details>
    </Section>
  );
}
