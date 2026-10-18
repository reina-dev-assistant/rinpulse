import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { ChipRow } from '@/components/ChipRow';
import { Field } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { sensorHub } from '@/features/sensors/instance';
import { getWheelMm, setWheelMm } from '@/features/sensors/settings';
import { fmtInt } from '@/i18n';
import { spacing, useColors } from '@/theme';

import { WHEEL_CIRCUMFERENCE_MM } from '../gatt';
import { parseWheelMm, WHEEL_MAX_MM, WHEEL_MIN_MM, WHEEL_PRESETS, wheelPresetOf } from './format';

/**
 * Wheel circumference: what a speed or power sensor's wheel revolutions are multiplied by. A preset or a typed size is stored at once
 * and handed to the sensor hub, so the live readings use it from the next value on; a recording reads it when it starts.
 */
export function WheelSection() {
  const { t } = useTranslation('watch');
  const colors = useColors();
  const [mm, setMm] = useState(getWheelMm);
  const [text, setText] = useState(() => String(getWheelMm()));
  const [touched, setTouched] = useState(false);

  const apply = (value: number) => {
    setWheelMm(value);
    sensorHub.setWheelCircumferenceM(value / 1000);
    setMm(value);
  };
  const onChangeText = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, 4);
    setText(digits);
    const parsed = parseWheelMm(digits);
    if (parsed !== null) apply(parsed);
  };

  const preset = wheelPresetOf(mm);
  const invalid = parseWheelMm(text) === null && (touched || text.length >= 4);
  const range = { min: fmtInt(WHEEL_MIN_MM), max: fmtInt(WHEEL_MAX_MM) };

  return (
    <Section title={t('sensors.wheel.title')} icon="disc">
      <AppText variant="caption" muted>
        {t('sensors.wheel.body')}
      </AppText>
      <View style={styles.presets}>
        <AppText variant="label" muted>
          {t('sensors.wheel.presets')}
        </AppText>
        <ChipRow
          bleed={false}
          inset={0}
          fadeColor={colors.card}
          items={WHEEL_PRESETS.map((name) => ({
            key: name,
            label: name,
            selected: preset === name,
            role: 'radio' as const,
            onPress: () => {
              setText(String(WHEEL_CIRCUMFERENCE_MM[name]));
              apply(WHEEL_CIRCUMFERENCE_MM[name]);
            },
          }))}
        />
      </View>
      <Field
        label={t('sensors.wheel.field')}
        hint={t('sensors.wheel.hint', range)}
        value={text}
        onChangeText={onChangeText}
        onBlur={() => setTouched(true)}
        keyboardType="number-pad"
        maxLength={4}
        returnKeyType="done"
      />
      {invalid ? <Notice tone="danger">{t('sensors.wheel.invalid', range)}</Notice> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  presets: { gap: spacing.xs },
});
