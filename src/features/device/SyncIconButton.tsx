import { useTranslation } from 'react-i18next';

import { HeaderIconButton } from '@/components/HeaderIconButton';
import { useSyncDone } from '@/features/device/useSyncDone';
import { useWatch } from '@/state/WatchProvider';

/**
 * "Sync now" as an icon for a page header: a spinner while it runs, then a check for a moment. With no connected watch it is off and
 * says why to screen readers.
 */
export function SyncIconButton() {
  const { t } = useTranslation('watch');
  const { t: tWorkouts } = useTranslation('workouts');
  const { linkState, device, lastSync, sync } = useWatch();
  const syncing = linkState === 'syncing';
  const done = useSyncDone(syncing, lastSync);
  const ready = linkState === 'connected' && device !== null;
  return (
    <HeaderIconButton
      icon="sync"
      label={syncing ? t('device.sync.syncing') : done ? t('device.sync.done') : t('device.sync.now')}
      hint={ready || syncing ? undefined : tWorkouts('list.connectToSync')}
      disabled={!ready}
      loading={syncing}
      done={done}
      onPress={() => void sync()}
    />
  );
}
