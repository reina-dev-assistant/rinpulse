import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Divider, Section } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { sensorHub } from '@/features/sensors/instance';
import type { Granted } from '@/features/sensors/permissions';
import { useSensors } from '@/state/SensorsProvider';
import { spacing, useColors } from '@/theme';

import type { ScanItem } from '../hub';
import { errorCode, scanName, sensorGlyph, type RadioFailure } from './format';
import { markSensorIntroSeen, sensorIntroSeen } from './intro';
import { KindTags, Signal } from './parts';

interface ScanSectionProps {
  /** The answer of the permission prompt a scan raised; null clears the last one. */
  onPermission: (answer: Granted | null) => void;
  onFailure: (failure: RadioFailure | null) => void;
}

/**
 * "Cari sensor". Until the person pressed "Lanjut" it only explains the Bluetooth permission; that press starts the first scan (which
 * asks for the permission) and asks the radio for its state (which is what raises the Bluetooth prompt on iOS). The scan stops by
 * itself after 20 s and the button then offers "Cari lagi".
 */
export function ScanSection({ onPermission, onFailure }: ScanSectionProps) {
  const { t } = useTranslation('watch');
  const { saved, hub, startScan, stopScan, pair } = useSensors();
  const [introduced, setIntroduced] = useState(sensorIntroSeen);
  const [starting, setStarting] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [pairingId, setPairingId] = useState<string | null>(null);

  const scan = async () => {
    setStarting(true);
    onPermission(null);
    onFailure(null);
    try {
      const answer = await startScan();
      onPermission(answer);
      if (answer === 'granted') setScanned(true);
    } catch (e) {
      onFailure({ code: errorCode(e), during: 'scan' });
    } finally {
      setStarting(false);
    }
    await sensorHub.refreshBluetooth().catch(() => {});
  };

  const onContinue = () => {
    markSensorIntroSeen();
    setIntroduced(true);
    void scan();
  };

  const pairIt = async (item: ScanItem) => {
    setPairingId(item.id);
    onFailure(null);
    try {
      await pair(item);
    } catch (e) {
      onFailure({ code: errorCode(e), during: 'connect' });
    } finally {
      setPairingId(null);
    }
  };

  const paired = new Set(saved.map((s) => s.id));
  const empty = scanned && !hub.scanning && !starting && hub.results.length === 0 && hub.scanError === null;

  return (
    <Section
      title={t('sensors.scan.title')}
      icon="search"
      trailing={
        hub.results.length > 0 ? (
          <AppText variant="caption" muted>
            {t('sensors.scan.found', { count: hub.results.length })}
          </AppText>
        ) : null
      }>
      {!introduced ? (
        <>
          <AppText variant="caption" muted>
            {t('sensors.scan.intro')}
          </AppText>
          <Button label={t('sensors.scan.continue')} variant="primary" icon="bluetooth" loading={starting} onPress={onContinue} />
        </>
      ) : (
        <>
          {hub.scanning ? <LoadingState label={t('sensors.scan.scanning')} /> : null}
          {hub.results.map((item, index) => (
            <View key={item.id} style={styles.item}>
              {index > 0 ? <Divider /> : null}
              <ScanRow item={item} paired={paired.has(item.id)} pairing={pairingId === item.id} onPair={() => void pairIt(item)} />
            </View>
          ))}
          {empty ? <Notice>{t('sensors.scan.none')}</Notice> : null}
          {hub.scanning ? (
            <Button label={t('sensors.scan.stop')} icon="close" onPress={() => void stopScan()} />
          ) : (
            <Button
              label={scanned ? t('sensors.scan.again') : t('sensors.scan.start')}
              variant="primary"
              icon="refresh"
              loading={starting}
              onPress={() => void scan()}
            />
          )}
        </>
      )}
      <AppText variant="caption" muted>
        {t('sensors.scan.tips')}
      </AppText>
    </Section>
  );
}

interface ScanRowProps {
  item: ScanItem;
  paired: boolean;
  pairing: boolean;
  onPair: () => void;
}

function ScanRow({ item, paired, pairing, onPair }: ScanRowProps) {
  const { t } = useTranslation('watch');
  const colors = useColors();
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <IconChip {...sensorGlyph(item.kinds)} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {scanName(item)}
          </AppText>
          <Signal rssi={item.rssi} />
        </View>
      </View>
      <KindTags kinds={item.kinds} />
      {paired ? (
        <View style={styles.pairedRow}>
          <Ionicons name="checkmark-circle" size={20} color={colors.link} />
          <AppText variant="bodyStrong">{t('sensors.scan.paired')}</AppText>
        </View>
      ) : (
        <Button label={t('sensors.scan.pair')} variant="primary" icon="add" loading={pairing} onPress={onPair} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.md },
  row: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  pairedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
});
