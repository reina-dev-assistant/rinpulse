import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Divider, Section } from '@/components/Screen';
import { EmptyState, LoadingState, Notice } from '@/components/States';
import { BondedRow } from '@/features/device/BondedRow';
import { noWatchFoundHint, noWatchFoundScanHint } from '@/features/device/connectFailure';
import { supportRank } from '@/features/device/modelSupport';
import type { BluetoothPermission } from '@/features/device/useBluetoothPermission';
import type { BondedDevices } from '@/features/device/useBondedDevices';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/** Paired watches shown before the list scrolls inside its card. */
const VISIBLE_BONDED = 3;

interface AvailableWatchesSectionProps {
  permission: BluetoothPermission;
  bonded: BondedDevices;
}

/**
 * The list of watches with the Bluetooth permission step, the scan and the connect, forget and disconnect buttons. The Watch tab and
 * the setup guide both show it, each owning the permission and device hooks (the tab feeds them to pull-to-refresh).
 */
export function AvailableWatchesSection({ permission, bonded }: AvailableWatchesSectionProps) {
  const { t } = useTranslation('watch');
  const watch = useWatch();
  const granted = permission.status === 'granted';
  // Measured row heights, so the list shows exactly VISIBLE_BONDED rows before it scrolls.
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});

  const linked = watch.linkState === 'connected' || watch.linkState === 'syncing';
  // iOS only: every listed watch is out of reach (a watch linked to another phone does not advertise). Android leaves `nearby` unset.
  const showNotInReach =
    bonded.loaded && !bonded.loading && !bonded.error && !linked && bonded.devices.length > 0 && bonded.devices.every((d) => d.nearby === false);

  // The watch in use first, then the ones this app can talk to best.
  const devices = useMemo(() => {
    const list = [...bonded.devices];
    if (watch.activeAddress && !list.some((d) => d.address === watch.activeAddress)) {
      list.unshift({
        address: watch.activeAddress,
        name: watch.device?.name || watch.activeAddress,
        model: watch.device?.model ?? null,
        support: watch.device?.support ?? 'tested',
        reason: null,
      });
    }
    return list.sort(
      (a, b) =>
        Number(b.address === watch.activeAddress) - Number(a.address === watch.activeAddress) ||
        supportRank(a.support) - supportRank(b.support),
    );
  }, [bonded.devices, watch.activeAddress, watch.device]);

  const showEmpty = devices.length === 0 && !bonded.loading && !bonded.error;
  const listMaxHeight = useMemo(() => {
    if (devices.length <= VISIBLE_BONDED) return undefined;
    const heights = devices.slice(0, VISIBLE_BONDED).map((d) => rowHeights[d.address]);
    return heights.every((h) => h !== undefined) ? heights.reduce((sum, h) => sum + h, 0) : undefined;
  }, [devices, rowHeights]);

  return (
    <Section
      title={bonded.scanning ? t('device.list.searching') : t('device.list.title')}
      icon="bluetooth"
      trailing={
        bonded.scanning ? (
          <AppText variant="caption" muted>
            {t('device.list.scanningShort')}
          </AppText>
        ) : devices.length > 0 ? (
          <AppText variant="caption" muted>
            {devices.length}
          </AppText>
        ) : null
      }>
      {permission.status === 'checking' ? (
        <LoadingState label={t('device.list.checkingPermission')} />
      ) : !granted ? (
        <>
          <Notice tone="danger">{t('device.list.permissionNeeded')}</Notice>
          {permission.status === 'blocked' ? (
            <Button label={t('device.list.openSettings')} icon="settings" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label={t('device.list.continue')} variant="primary" icon="bluetooth" onPress={() => void permission.request()} />
          )}
        </>
      ) : (
        <>
          {bonded.error ? <Notice tone="danger">{t('device.list.readError', { error: bonded.error })}</Notice> : null}
          {showNotInReach ? (
            <Notice action={{ label: t('device.list.refresh'), onPress: () => void bonded.refresh() }}>{noWatchFoundHint()}</Notice>
          ) : null}
          {!isIos && !bonded.scanning && bonded.scanFound === 0 && !linked ? (
            <Notice action={{ label: t('device.list.scanAgain'), onPress: () => void bonded.startScan() }}>{noWatchFoundScanHint()}</Notice>
          ) : null}
          {showEmpty ? (
            <EmptyState
              icon="bluetooth"
              title={isIos ? t('device.list.emptyIos') : bonded.scanning ? t('device.list.scanning') : t('device.list.emptyAndroid')}
              description={
                isIos
                  ? noWatchFoundHint()
                  : bonded.scanning
                    ? t('device.list.scanningHint')
                    : t('device.list.emptyHint')
              }
              action={
                isIos
                  ? { label: t('device.list.refreshList'), icon: 'refresh', onPress: () => void bonded.refresh() }
                  : {
                      label: bonded.scanning ? t('device.list.scanningShort') : t('device.list.scan'),
                      icon: 'refresh',
                      onPress: () => {
                        void bonded.reload();
                        void bonded.startScan();
                      },
                    }
              }
            />
          ) : (
            <>
              <ScrollView
                style={listMaxHeight === undefined ? undefined : { maxHeight: listMaxHeight }}
                scrollEnabled={listMaxHeight !== undefined}
                nestedScrollEnabled
                showsVerticalScrollIndicator>
                {devices.map((d, index) => (
                  <View
                    key={d.address}
                    style={[styles.bonded, index > 0 && styles.bondedNext]}
                    onLayout={(e) => {
                      const height = e.nativeEvent.layout.height;
                      setRowHeights((prev) => (prev[d.address] === height ? prev : { ...prev, [d.address]: height }));
                    }}>
                    {index > 0 ? <Divider /> : null}
                    <BondedRow
                      device={d}
                      linkState={watch.linkState}
                      activeAddress={watch.activeAddress}
                      onConnect={(address) => {
                        void bonded.stopScan();
                        void watch.switchTo(address);
                      }}
                      onDisconnect={() => void watch.disconnect()}
                      onForget={(address) => {
                        void watch.forget(address).then(() => void bonded.reload());
                      }}
                    />
                  </View>
                ))}
              </ScrollView>
              {isIos ? (
                <Button label={t('device.list.refreshList')} icon="refresh" loading={bonded.loading} onPress={() => void bonded.refresh()} />
              ) : (
                <Button
                  label={bonded.scanning ? t('device.list.stopScan') : linked ? t('device.list.scanOther') : t('device.list.scan')}
                  icon={bonded.scanning ? 'close' : 'refresh'}
                  loading={bonded.loading}
                  onPress={() => {
                    if (bonded.scanning) {
                      void bonded.stopScan();
                    } else {
                      void bonded.reload();
                      void bonded.startScan();
                    }
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  bonded: { gap: spacing.md },
  bondedNext: { paddingTop: spacing.md },
});
