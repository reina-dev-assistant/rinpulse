import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useWatch } from '@/state/WatchProvider';
import { RefetchDynamicsBulk } from '@/features/workouts/ui/RefetchDynamics';

/**
 * The first sync after binding already pulls everything the watch still holds; this re-runs that pull, for a watch
 * that was bound before or a pull that was cut short. Stored rows are kept and updated, never duplicated.
 */
export function HistorySection() {
  const { t } = useTranslation('settings');
  const { linkState, device, error, syncFullHistory } = useWatch();
  const syncing = linkState === 'syncing';
  const canSync = linkState === 'connected' && device !== null;

  return (
    <Section title={t('history.title')} icon="time" tint="heart">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        label={syncing ? t('history.fetching') : t('history.fetch')}
        variant="secondary"
        icon="cloud-download-outline"
        onPress={() => void syncFullHistory()}
        disabled={!canSync}
        loading={syncing}
      />
      {!canSync && !syncing ? (
        <AppText variant="caption" muted>
          {t('history.connectFirst')}
        </AppText>
      ) : null}
      <Details>
        {isIos ? t('history.detailsIos') : t('history.details')}
      </Details>
      <RefetchDynamicsBulk />
    </Section>
  );
}
