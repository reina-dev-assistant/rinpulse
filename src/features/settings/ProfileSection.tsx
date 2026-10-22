import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import type { IconName } from '@/components/IconChip';
import { Field } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { syncHrZonesToWatch } from '@/features/hrzones/settings';
import { DEFAULT_STEP_GOAL, parseStepGoal } from '@/features/today/stepGoal';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { HuaweiWear, type UserProfile, type UserSex } from '@/wear';
import { spacing } from '@/theme';

const DEFAULT_PROFILE: UserProfile = {
  heightCm: 175,
  weightKg: 70,
  birthYear: 1990,
  sex: 'unknown',
  dailyStepGoal: DEFAULT_STEP_GOAL,
};

const SEXES: readonly UserSex[] = ['male', 'female', 'unknown'];

interface Fields {
  height: string;
  weight: string;
  birthYear: string;
  steps: string;
}

/** Parses the form; returns the first validation message when any field is out of range. */
function parseFields(fields: Fields, sex: UserSex): UserProfile | string {
  const height = Number(fields.height.trim());
  if (!Number.isInteger(height) || height < 100 || height > 250) {
    return t('settings:profile.errors.height');
  }
  const weight = Number(fields.weight.trim().replace(',', '.'));
  if (!Number.isFinite(weight) || weight < 20 || weight > 300) {
    return t('settings:profile.errors.weight');
  }
  const currentYear = new Date().getFullYear();
  const birthYear = Number(fields.birthYear.trim());
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear) {
    return t('settings:profile.errors.birthYear', { year: currentYear });
  }
  const dailyStepGoal = parseStepGoal(fields.steps);
  if (dailyStepGoal === null) {
    return t('settings:profile.errors.steps');
  }
  return { heightCm: height, weightKg: Math.round(weight * 10) / 10, birthYear, sex, dailyStepGoal };
}

interface NumberFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  icon: IconName;
  decimal?: boolean;
}

function NumberField({ label, value, onChangeText, icon, decimal }: NumberFieldProps) {
  return (
    <Field
      label={label}
      icon={icon}
      value={value}
      onChangeText={onChangeText}
      keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
    />
  );
}

export function ProfileSection() {
  const { t } = useTranslation(['settings', 'common']);
  const [initial] = useState(() => HuaweiWear.getUserProfile() ?? DEFAULT_PROFILE);
  const [fields, setFields] = useState<Fields>({
    height: String(initial.heightCm),
    weight: String(initial.weightKg),
    birthYear: String(initial.birthYear),
    steps: String(initial.dailyStepGoal),
  });
  const [sex, setSex] = useState<UserSex>(initial.sex);
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const edit = (key: keyof Fields) => (text: string) => {
    setFields((current) => ({ ...current, [key]: text }));
    setMessage(null);
  };

  const save = async () => {
    const parsed = parseFields(fields, sex);
    if (typeof parsed === 'string') {
      setMessage({ text: parsed, danger: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const sent = await HuaweiWear.setUserProfile(parsed);
      // The zones follow the age while the maximum heart rate is not set by hand.
      void syncHrZonesToWatch();
      setMessage({
        text: sent ? t('profile.sent') : t('profile.saved'),
        danger: false,
      });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t('profile.title')} icon="person">
      <View style={styles.row}>
        <View style={styles.cell}>
          <NumberField label={t('profile.height')} value={fields.height} onChangeText={edit('height')} icon="resize" />
        </View>
        <View style={styles.cell}>
          <NumberField label={t('profile.weight')} value={fields.weight} onChangeText={edit('weight')} icon="barbell" decimal />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.cell}>
          <NumberField label={t('profile.birthYear')} value={fields.birthYear} onChangeText={edit('birthYear')} icon="calendar" />
        </View>
        <View style={styles.cell}>
          <NumberField label={t('profile.steps')} value={fields.steps} onChangeText={edit('steps')} icon="footsteps" />
        </View>
      </View>
      <View style={styles.field}>
        <AppText variant="label" muted>
          {t('profile.sexLabel')}
        </AppText>
        <Segmented
          options={SEXES.map((value) => ({ value, label: t(`profile.sex.${value}`) }))}
          value={sex}
          onChange={(next) => {
            setSex(next);
            setMessage(null);
          }}
        />
      </View>
      {message ? <Notice tone={message.danger ? 'danger' : 'info'}>{message.text}</Notice> : null}
      <Button label={t('common:actions.save')} variant="primary" onPress={save} loading={saving} />
      <Details>{t('profile.details')}</Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1 },
});
