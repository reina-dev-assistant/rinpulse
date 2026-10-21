import { useTranslation } from 'react-i18next';

import { Details } from '@/components/Details';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Section } from '@/components/Screen';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { OTA_ENABLED, useOtaUpdate } from '@/features/updates/useOtaUpdate';

/**
 * About screen block for over-the-air JS updates (expo-updates, docs/ota.md): which bundle runs, whether a
 * newer one is downloading or waiting for a restart, and a manual check. Renders nothing in dev clients and
 * Expo Go, where OTA is off.
 */
export function OtaSection() {
  const { t } = useTranslation('settings');
  const ota = useOtaUpdate();
  if (!OTA_ENABLED) return null;

  const busy = ota.phase === 'checking' || ota.phase === 'downloading';
  const running =
    ota.source === 'update' && ota.updateId
      ? t('updates.running.update', {
          id: ota.updateId.slice(0, 8),
          date: ota.createdAt ? ota.createdAt.toISOString().slice(0, 10) : '',
        })
      : ota.source === 'emergency'
        ? t('updates.running.emergency')
        : t('updates.running.embedded');
  const status = ota.phase === 'downloading' && ota.percent !== null ? t('updates.status.downloadingPercent', { percent: ota.percent })
      : t(`updates.status.${ota.phase}`);

  return (
    <Section title={t('updates.title')} icon="cloud-download">
      <PairGrid>
        <Pair label={t('updates.labels.status')} value={status} />
        <Pair label={t('updates.labels.channel')} value={ota.channel} />
        <Pair label={t('updates.labels.running')} value={running} wide />
        <Pair label={t('updates.labels.runtime')} value={ota.runtimeVersion ? ota.runtimeVersion.slice(0, 8) : null} />
      </PairGrid>
      <ButtonRow>
        {ota.phase === 'ready' ? (
          <Button label={t('updates.restart')} variant="primary" onPress={() => void ota.restart()} />
        ) : null}
        <Button
          label={busy ? t('updates.checking') : t('updates.check')}
          onPress={() => void ota.check()}
          loading={busy}
          disabled={busy}
        />
      </ButtonRow>
      <Details>{t('updates.hint')}</Details>
    </Section>
  );
}
