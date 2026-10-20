import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import type { ProtocolSecret } from '@/features/scale/types';
import type { ScaleSecretState } from '@/state/ScaleProvider';
import { spacing } from '@/theme';

interface SecretSectionProps {
  kind: ProtocolSecret['kind'];
  state: Exclude<ScaleSecretState, 'none' | 'loading'>;
  /** Resolves false when the text is not a valid key. */
  onSave: (text: string) => Promise<boolean>;
  onClear: () => Promise<void>;
}

/** Advanced: the key a scale with encrypted broadcasts needs. It stays on this phone, in the secure store. */
export function SecretSection({ kind, state, onSave, onClear }: SecretSectionProps) {
  const { t } = useTranslation('scale');
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const save = async () => {
    const ok = await onSave(text);
    setInvalid(!ok);
    if (ok) {
      setText('');
      setShown(false);
    }
  };

  return (
    <Section title={t('secret.title')} icon="key-outline">
      <AppText variant="caption" muted>
        {t(`secret.${kind}.explain`)}
      </AppText>
      {state === 'saved' ? (
        <>
          <AppText variant="bodyStrong">{t('secret.saved')}</AppText>
          <Button label={t('secret.remove')} icon="trash-outline" variant="ghost" onPress={() => void onClear()} />
        </>
      ) : (
        <>
          <Field
            label={t(`secret.${kind}.label`)}
            hint={t('secret.length', { length: text.trim().length })}
            value={text}
            onChangeText={(value) => {
              setText(value);
              setInvalid(false);
            }}
            secureTextEntry={!shown}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            importantForAutofill="no"
            maxLength={64}
          />
          {invalid ? <Notice tone="danger">{t(`secret.${kind}.invalid`)}</Notice> : null}
          <View style={styles.actions}>
            <Button label={shown ? t('secret.hide') : t('secret.show')} icon={shown ? 'eye-off-outline' : 'eye-outline'} onPress={() => setShown((v) => !v)} />
            <Button label={t('secret.save')} icon="checkmark" variant="primary" disabled={text.trim().length === 0} onPress={() => void save()} />
          </View>
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
});
