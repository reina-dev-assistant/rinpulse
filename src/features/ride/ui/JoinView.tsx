import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useRide } from '@/state/RideProvider';
import { spacing } from '@/theme';

import { RIDE_WEB_URL } from '../links';
import { cleanCode, isCompleteCode } from './format';

/** Not in a room: the six digit code from the game's screen (prefilled when the QR opened the app), and why joining can fail. */
export function JoinView({ initialCode }: { initialCode: string }) {
  const { t } = useTranslation('ride');
  const router = useRouter();
  const { snapshot, join } = useRide();
  const [code, setCode] = useState(cleanCode(initialCode));
  const busy = snapshot.phase === 'joining';
  const error = snapshot.error;

  return (
    <>
      <Section title={t('join.title')} icon="laptop-outline" tint="link">
        <AppText variant="caption" muted>
          {t('join.steps', { url: RIDE_WEB_URL.replace(/^https?:\/\//, '') })}
        </AppText>
        {initialCode !== '' && code === cleanCode(initialCode) ? <Notice icon="qr-code">{t('join.fromLink')}</Notice> : null}
        <Field
          label={t('join.codeLabel')}
          value={code}
          onChangeText={(text) => setCode(cleanCode(text))}
          placeholder={t('join.codePlaceholder')}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={80}
          autoComplete="off"
          autoCorrect={false}
          style={styles.code}
          returnKeyType="go"
          onSubmitEditing={() => isCompleteCode(code) && void join(code)}
        />
        {error ? (
          <Notice
            tone="danger"
            action={error.kind === 'notSignedIn' ? { label: t('error.notSignedInAction'), onPress: () => router.push('/settings/akun') } : undefined}>
            {t(`error.${error.kind}`)}
          </Notice>
        ) : null}
        <Button label={t('join.action')} variant="primary" icon="log-in-outline" disabled={!isCompleteCode(code)} loading={busy} style={styles.action} onPress={() => void join(code)} />
      </Section>
      <AppText variant="caption" muted>
        {t('join.ride')}
      </AppText>
      <AppText variant="caption" muted>
        {t('join.account')}
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 28, letterSpacing: 6, textAlign: 'center', fontVariant: ['tabular-nums'] },
  action: { minHeight: 56, marginTop: spacing.xs },
});
