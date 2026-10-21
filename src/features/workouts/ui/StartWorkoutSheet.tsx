import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet } from 'react-native';

import { NavRow } from '@/components/NavRow';
import { BottomSheet } from '@/features/strength/ui/Sheet';

interface StartWorkoutSheetProps {
  visible: boolean;
  onClose: () => void;
  /** A recording is already running: it is open from the banner, so there is nothing to start here. */
  recording: boolean;
  onRecord: () => void;
  onStrength: () => void;
  onManual: () => void;
  onImportFit: () => void;
  onLoop: () => void;
}

/**
 * The one place Workouts starts anything: record on the phone, the strength logger, a workout by hand, a FIT file. Choosing a row closes
 * the sheet first and runs the action once it is gone, so the file picker never opens over a sheet that is still leaving.
 */
export function StartWorkoutSheet({ visible, onClose, recording, onRecord, onStrength, onManual, onImportFit, onLoop }: StartWorkoutSheetProps) {
  const { t } = useTranslation('workouts');
  const { t: tl } = useTranslation('loops');
  const pending = useRef<(() => void) | null>(null);

  const flush = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  const choose = (run: () => void) => () => {
    pending.current = run;
    onClose();
    // Android has no dismiss event; the sheet's close is a plain unmount there.
    if (Platform.OS !== 'ios') flush();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} onDismiss={flush} title={t('list.start.title')}>
      {recording ? null : (
        <NavRow
          icon="radio-button-on"
          tint="workouts"
          title={t('list.start.record.title')}
          subtitle={t('list.start.record.subtitle')}
          onPress={choose(onRecord)}
          style={styles.row}
        />
      )}
      <NavRow
        icon="barbell"
        tint="workouts"
        title={t('list.start.strength.title')}
        subtitle={t('list.start.strength.subtitle')}
        onPress={choose(onStrength)}
        style={styles.row}
      />
      <NavRow
        icon="create-outline"
        title={t('list.start.manual.title')}
        subtitle={t('list.start.manual.subtitle')}
        onPress={choose(onManual)}
        style={styles.row}
      />
      <NavRow
        icon="bicycle"
        title={t('list.start.fit.title')}
        subtitle={t('list.start.fit.subtitle')}
        onPress={choose(onImportFit)}
        style={styles.row}
      />
      <NavRow icon="repeat" tint="steps" title={tl('shortcut.title')} subtitle={tl('shortcut.subtitle')} onPress={choose(onLoop)} style={styles.row} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  /** The sheet already pads its sides; the row's own inset would double it. */
  row: { paddingHorizontal: 0 },
});
