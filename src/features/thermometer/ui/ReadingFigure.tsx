import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { fmtDecimal } from '@/i18n/format';
import { spacing, useColors } from '@/theme';

import { humidityStatus, IDEAL_RH_PCT, IDEAL_TEMP_C, tempStatus } from '../ideal';
import type { EnvSample } from '../store';

interface ReadingFigureProps {
  value: string;
  unit: string;
  /** The plain status under the figure ("Agak hangat untuk tidur"). */
  status: string;
  /** The ideal range ("Ideal 18–25 °C"). */
  range: string;
  /** Whether the reading is inside the ideal range: any other status takes the warning color (the words carry the meaning, the color only echoes it). */
  ideal: boolean;
}

/** One reading as a big figure with what it means for sleep and the ideal range under it. */
function ReadingFigure({ value, unit, status, range, ideal }: ReadingFigureProps) {
  const colors = useColors();
  return (
    <View style={styles.figure}>
      <Metric value={value} unit={unit} size="hero" />
      <AppText variant="label" color={ideal ? colors.foreground : colors.warning} style={styles.text}>
        {status}
      </AppText>
      <AppText variant="caption" muted style={styles.text}>
        {range}
      </AppText>
    </View>
  );
}

/** The newest reading: temperature and humidity side by side, each with its status for sleep and the ideal range. Read as one sentence by a screen reader. */
export function ReadingFigures({ last }: { last: EnvSample }) {
  const { t } = useTranslation('thermometer');
  const temp = tempStatus(last.tempC);
  const humidity = humidityStatus(last.rhPct);
  const tempText = fmtDecimal(last.tempC, 1);
  const rhText = fmtDecimal(last.rhPct, 1);
  return (
    <View
      style={styles.figures}
      accessible
      accessibilityLabel={t('card.a11y', { temp: tempText, tempStatus: t(`ideal.temp.${temp}`), rh: rhText, rhStatus: t(`ideal.humidity.${humidity}`) })}>
      <ReadingFigure
        value={tempText}
        unit={t('card.tempUnit')}
        status={t(`ideal.temp.${temp}`)}
        range={t('ideal.tempRange', { from: IDEAL_TEMP_C.min, to: IDEAL_TEMP_C.max })}
        ideal={temp === 'ideal'}
      />
      <ReadingFigure
        value={rhText}
        unit={t('card.rhUnit')}
        status={t(`ideal.humidity.${humidity}`)}
        range={t('ideal.humidityRange', { from: IDEAL_RH_PCT.min, to: IDEAL_RH_PCT.max })}
        ideal={humidity === 'ideal'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  figures: { flexDirection: 'row', alignSelf: 'stretch', alignItems: 'flex-start', justifyContent: 'center', gap: spacing.lg },
  figure: { flexShrink: 1, alignItems: 'center' },
  text: { textAlign: 'center' },
});
