import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Section } from '@/components/Screen';
import { fmtDecimal } from '@/i18n/format';
import type { Granted } from '@/features/sensors/permissions';
import { Signal } from '@/features/sensors/ui/parts';
import { spacing } from '@/theme';

import type { FoundThermometer } from '../discovery';
import type { GattResult } from '../gattRead';
import type { BindkeyPairResult } from '../useThermometer';
import { StockOptions } from './StockOptions';
import type { ThermometerDiscovery } from './useThermometerDiscovery';

interface ThermometerPickerProps {
  discovery: ThermometerDiscovery;
  /** The id of the thermometer already in use. */
  currentId: string | null;
  onPermission: (granted: Granted) => void;
  onPick: (device: FoundThermometer) => void;
  /** A stock-firmware unit, read over a connection. */
  onPairGatt: (device: FoundThermometer) => Promise<GattResult>;
  /** A stock-firmware unit, read from its encrypted broadcasts with the typed-in bind key. */
  onPairBindkey: (device: FoundThermometer, text: string) => Promise<BindkeyPairResult>;
}

/** Search for the room thermometer and pick it. The first search is preceded by what it does and a "Lanjut" (it is what raises the iOS prompt). */
export function ThermometerPicker({ discovery, currentId, onPermission, onPick, onPairGatt, onPairBindkey }: ThermometerPickerProps) {
  const { t } = useTranslation('thermometer');
  const [explained, setExplained] = useState(false);
  const startedOnce = discovery.searching || discovery.devices.length > 0;

  const begin = async () => {
    onPermission(await discovery.start());
  };

  return (
    <Section title={t('picker.title')} icon="search">
      {!explained && !startedOnce ? (
        <>
          <AppText variant="caption" muted>
            {t('picker.explain')}
          </AppText>
          <Button
            label={t('picker.continue')}
            variant="primary"
            onPress={() => {
              setExplained(true);
              void begin();
            }}
          />
        </>
      ) : (
        <>
          <AppText variant="caption" muted>
            {t('picker.hint')}
          </AppText>
          {discovery.searching ? (
            <Button label={t('picker.stopSearch')} icon="stop-circle-outline" onPress={discovery.stop} />
          ) : (
            <Button label={t('picker.search')} icon="search" variant="primary" onPress={() => void begin()} />
          )}
          {discovery.devices.length === 0 ? (
            <AppText variant="caption" muted>
              {discovery.searching ? t('picker.searching') : t('picker.none')}
            </AppText>
          ) : null}
          {discovery.devices.length > 0 ? (
            <View style={styles.list}>
              {discovery.devices.map((device, index) => (
                <View key={device.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.row}>
                    <View style={styles.text}>
                      <AppText variant="bodyStrong">{device.name ?? t('picker.unnamed')}</AppText>
                      {device.reading ? (
                        <AppText variant="caption">
                          {t('picker.reading', { temp: fmtDecimal(device.reading.tempC, 1), rh: fmtDecimal(device.reading.rhPct, 1) })}
                        </AppText>
                      ) : (
                        <AppText variant="caption" muted>
                          {t('picker.unreadable')}
                        </AppText>
                      )}
                      <Signal rssi={device.rssi} />
                    </View>
                    {device.readable ? (
                      <Button
                        label={device.id === currentId ? t('picker.chosen') : t('picker.pick')}
                        variant={device.id === currentId ? 'secondary' : 'primary'}
                        disabled={device.id === currentId}
                        onPress={() => onPick(device)}
                      />
                    ) : null}
                  </View>
                  {!device.readable && device.id !== currentId ? (
                    <StockOptions
                      device={device}
                      onPairGatt={async (d) => {
                        // The sensor serves one connection at a time and the radio does better without a scan running beside it.
                        discovery.stop();
                        return onPairGatt(d);
                      }}
                      onPairBindkey={onPairBindkey}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
});
