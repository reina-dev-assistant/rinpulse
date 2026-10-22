import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { parseWeightKg, withWeight } from '@/features/onboarding/weight';
import { DEFAULT_STEP_GOAL } from '@/features/today/stepGoal';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';
import { HuaweiWear, type UserProfile } from '@/wear';

const FALLBACK: UserProfile = { heightCm: 175, weightKg: 70, birthYear: 1990, sex: 'unknown', dailyStepGoal: DEFAULT_STEP_GOAL };

/** Body weight only: what the strength logger's energy estimate runs on. The full profile (height, birth year, sex) stays in Settings. */
export function WeightForm() {
  const { t } = useTranslation('onboarding');
  const [text, setText] = useState(() => {
    const stored = HuaweiWear.getUserProfile();
    return stored ? String(stored.weightKg) : '';
  });
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const weight = parseWeightKg(text);
    if (weight === null) {
      setMessage({ text: t('phone.weightInvalid'), danger: true });
      return;
    }
    setSaving(true);
    try {
      await HuaweiWear.setUserProfile(withWeight(HuaweiWear.getUserProfile(), weight, FALLBACK));
      setMessage({ text: t('phone.weightSaved', { kg: weight }), danger: false });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Field
        label={t('phone.weightLabel')}
        icon="barbell"
        value={text}
        onChangeText={(next) => {
          setText(next);
          setMessage(null);
        }}
        keyboardType="decimal-pad"
        placeholder="70"
      />
      <View style={styles.actions}>
        <Button label={t('phone.weightSave')} variant="secondary" loading={saving} onPress={() => void save()} />
      </View>
      {message ? <Notice tone={message.danger ? 'danger' : 'info'}>{message.text}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: spacing.sm },
});
