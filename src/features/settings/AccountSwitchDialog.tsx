import { useTranslation } from 'react-i18next';

import { ChoiceDialog } from '@/components/ChoiceDialog';

export type SwitchChoice = 'keep' | 'delete';

interface AccountSwitchDialogProps {
  /** Email of the account whose data this phone still holds; null when it was never stored (the dialog then says "the previous account"). */
  previousEmail: string | null;
  visible: boolean;
  /** The answer is being carried out: `choice` says which button spins. */
  choice: SwitchChoice | null;
  onChoose: (choice: SwitchChoice) => void;
  /** The person backs out: signed out again, the data stays. */
  onSignOut: () => void;
}

/**
 * Shown when a different account signs in on a phone that still holds the previous account's data. Cloud sync is paused until
 * the person answers (`CloudProvider`), so nothing of the old data reaches the new account before then. "Keep separate" is
 * the default: nothing is deleted, nothing is uploaded. The dialog cannot be dismissed by a tap outside or Back, because
 * either would have to guess an answer.
 */
export function AccountSwitchDialog({ previousEmail, visible, choice, onChoose, onSignOut }: AccountSwitchDialogProps) {
  const { t } = useTranslation('settings');
  return (
    <ChoiceDialog
      visible={visible}
      title={t('accountSwitch.title')}
      message={t('accountSwitch.message', { previous: previousEmail ?? t('accountSwitch.previousUnknown') })}
      choices={[
        { label: t('accountSwitch.keep'), variant: 'primary', loading: choice === 'keep', onPress: () => onChoose('keep') },
        { label: t('accountSwitch.delete'), variant: 'destructive', loading: choice === 'delete', onPress: () => onChoose('delete') },
      ]}
      cancelLabel={t('accountSwitch.signOut')}
      busy={choice !== null}
      dismissable={false}
      onCancel={onSignOut}
    />
  );
}
