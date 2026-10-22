import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { isIos } from '@/components/IosUnavailable';
import { localOnlyMode } from '@/features/settings/localOnly';
import { useCloud } from '@/state/CloudProvider';

/**
 * The JoyoRogo sign-in buttons: Apple and Google where Sign in with Apple runs (iPhone), Google otherwise. Settings and the setup guide both use it.
 *
 * Renders **nothing** in local-only mode: this phone is used by one person and the app works without an
 * account, so a "Masuk" button is noise at best. Every caller already handles an empty child (they sit in a
 * fragment or a Card), so no call site needs to know about the mode.
 */
export function SignInButtons({ label, prompt }: { label?: string; prompt?: string } = {}) {
  const { t } = useTranslation('settings');
  const cloud = useCloud();

  if (localOnlyMode()) return null;

  if (isIos && cloud.appleAvailable) {
    return (
      <>
        <AppText variant="label" muted>
          {prompt ?? t('signIn.prompt')}
        </AppText>
        <ButtonRow>
          <Button
            label={t('signIn.apple')}
            variant="primary"
            icon="logo-apple"
            onPress={() => void cloud.signInApple()}
            disabled={cloud.sessionPending}
          />
          <Button
            label={t('signIn.google')}
            variant="secondary"
            icon="logo-google"
            onPress={() => void cloud.signIn()}
            disabled={cloud.sessionPending}
            loading={cloud.sessionPending}
          />
        </ButtonRow>
      </>
    );
  }

  return (
    <Button
      label={label ?? t('signIn.label')}
      variant="primary"
      icon="log-in-outline"
      onPress={() => void cloud.signIn()}
      disabled={cloud.sessionPending}
      loading={cloud.sessionPending}
    />
  );
}
