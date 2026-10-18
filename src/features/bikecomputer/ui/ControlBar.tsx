import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { RidePalette } from './ridePalette';
import { RideButton } from './RideButton';

interface ControlBarProps {
  palette: RidePalette;
  paused: boolean;
  /** Finishing is being written to the database. */
  saving: boolean;
  /** At the right edge as a column (landscape) instead of along the bottom. */
  column: boolean;
  onTogglePause: () => void;
  onLap: () => void;
  onFinish: () => void;
}

/**
 * Pause or resume, lap and finish: the only controls of the ride screen, each at least 64 dp, away from the swipe surface. The bottom row
 * keeps an icon on the main button only; the side column has room for all three.
 */
export function ControlBar({ palette, paused, saving, column, onTogglePause, onLap, onFinish }: ControlBarProps) {
  const { t } = useTranslation('bikecomp');
  return (
    <View
      accessibilityLabel={t('a11y.controls')}
      style={[column ? styles.column : styles.row, { backgroundColor: palette.background, borderColor: palette.hairline }, column ? styles.columnEdge : styles.rowEdge]}>
      <RideButton
        label={paused ? t('controls.resume') : t('controls.pause')}
        icon={paused ? 'play' : 'pause'}
        variant="filled"
        palette={palette}
        disabled={saving}
        onPress={onTogglePause}
        style={column ? styles.fill : styles.main}
      />
      <RideButton label={t('controls.lap')} icon={column ? 'flag' : undefined} palette={palette} disabled={saving || paused} onPress={onLap} style={column ? styles.fill : styles.side} />
      <RideButton
        label={t('controls.finish')}
        icon={column ? 'stop-circle' : undefined}
        variant="outline"
        palette={palette}
        disabled={saving}
        onPress={onFinish}
        style={column ? styles.fill : styles.side}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, padding: 8 },
  rowEdge: { borderTopWidth: StyleSheet.hairlineWidth },
  column: { width: 148, gap: 8, padding: 8 },
  columnEdge: { borderLeftWidth: StyleSheet.hairlineWidth },
  main: { flex: 1.4 },
  side: { flex: 1 },
  fill: { flex: 1 },
});
