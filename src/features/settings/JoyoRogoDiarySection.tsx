import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useDiaryStatus } from '@/cloud/useDiaryStatus';
import { formatCount, formatDateTime } from '@/format';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';

/**
 * Settings, Koneksi, JoyoRogo: whether the energy of the workouts reaches JoyoRogo's diary (the push in `cloud/watchKcal.ts`,
 * `phoneKcal.ts` and `strengthKcal.ts`): when something last went through, how many workouts JoyoRogo has been told about, how
 * many wait for the next sync, and the last error. "Send now" runs a sync, which sends what waits.
 */
export function JoyoRogoDiarySection() {
  const { t } = useTranslation('settings');
  const cloud = useCloud();
  const status = useDiaryStatus();

  return (
    <Section title={t('joyorogo.title')} icon="restaurant">
      {cloud.signedIn ? (
        <>
          {cloud.autoSync ? null : <Notice icon="sync">{t('joyorogo.autoSyncOff')}</Notice>}
          <PairGrid>
            <Pair label={t('joyorogo.labels.lastSent')} value={status ? (status.lastSentAt ? formatDateTime(status.lastSentAt / 1000) : t('joyorogo.never')) : null} />
            <Pair label={t('joyorogo.labels.sent')} value={status ? t('joyorogo.sent', { count: status.sentCount, n: formatCount(status.sentCount) }) : null} />
            <Pair
              label={t('joyorogo.labels.waiting')}
              value={status ? (status.pending > 0 ? t('joyorogo.waiting', { count: status.pending, n: formatCount(status.pending) }) : t('joyorogo.nothingWaiting')) : null}
            />
            <Pair
              label={t('joyorogo.labels.error')}
              value={status ? (status.lastError ? t('joyorogo.errorValue', { message: status.lastError, when: formatDateTime((status.lastErrorAt ?? 0) / 1000) }) : t('joyorogo.nothingWaiting')) : null}
              wide
            />
          </PairGrid>
          {status && status.pending > 0 ? (
            <AppText variant="caption" muted>
              {t('joyorogo.waitingHint')}
            </AppText>
          ) : null}
          <Button label={t('joyorogo.sendNow')} variant="primary" icon="sync" onPress={() => void cloud.syncNow()} loading={cloud.uploading} />
        </>
      ) : (
        <>
          <Notice icon="person-outline">{t('joyorogo.signedOut')}</Notice>
          <SignInButtons />
        </>
      )}
      <Details>{t('joyorogo.intro')}</Details>
    </Section>
  );
}
