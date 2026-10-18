import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { rogo, type RogoSocialProfile } from '@/cloud/rogo';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { errorMessage } from '@/format';

interface ShareMapsCardProps {
  profile: RogoSocialProfile;
  /** Called with the profile as JoyoRogo now has it. */
  onChange: (profile: RogoSocialProfile) => void;
}

/** The account switch "Peta rute di postingan": off hides the route map of every post of the account, for everyone. */
export function ShareMapsCard({ profile, onChange }: ShareMapsCardProps) {
  const { t } = useTranslation('social');
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (shareMaps: boolean) => {
    setPending(shareMaps);
    setError(null);
    try {
      await rogo.social.updateProfile({ shareMaps });
      onChange({ ...profile, shareMaps });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <SwitchRow
        label={t('profile.shareMaps')}
        hint={t('profile.shareMapsHint')}
        value={pending ?? profile.shareMaps !== false}
        onValueChange={(shareMaps) => void change(shareMaps)}
        disabled={pending !== null}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Card>
  );
}
