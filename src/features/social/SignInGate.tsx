import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { localOnlyMode } from '@/features/settings/localOnly';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';

/** What a screen shows: its content for a signed-in JoyoRogo account, the sign-in prompt otherwise. `copy` words the prompt for another feature than Social. */
export function SignInGate({ children, copy: given }: { children: ReactNode; copy?: { title: string; description: string } }) {
  const { t } = useTranslation('social');
  const cloud = useCloud();
  const copy = given ?? { title: t('gate.title'), description: t('gate.description') };
  // Local-only mode: the feed, groups and profiles are the one part of the app that only exists on JoyoRogo's
  // server, so the gate cannot be satisfied. Showing a "Masuk" card the person never wants is worse than the
  // screen saying so plainly — hence a notice, not buttons.
  if (localOnlyMode()) {
    return (
      <Card>
        <Notice icon="information-circle">{t('gate.localOnly')}</Notice>
      </Card>
    );
  }
  if (cloud.sessionPending) return <Skeleton width="100%" height={120} radius="card" />;
  if (!cloud.signedIn) {
    return (
      <Card>
        <AppText variant="heading">{copy.title}</AppText>
        <AppText variant="caption" muted>
          {copy.description}
        </AppText>
        {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
        <SignInButtons />
      </Card>
    );
  }
  return <>{children}</>;
}
