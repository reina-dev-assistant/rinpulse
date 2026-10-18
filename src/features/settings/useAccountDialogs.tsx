import { useSQLiteContext } from 'expo-sqlite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_BUILD } from '@/cloud/build';
import { loadOverview } from '@/cloud/overview';
import { recordSyncPending } from '@/cloud/recordSync';
import { ChoiceDialog } from '@/components/ChoiceDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isIos } from '@/components/IosUnavailable';
import { countDirtyStrength, hasLocalData } from '@/db/localData';
import { formatCount } from '@/format';
import type { TFunction } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';

import { keepReason, pendingTotal, signOutPlan, type KeepReason, type PendingLocal } from './signOutPlan';

/** What the sign-out dialog says, decided when the person taps "Sign out". `empty`: the phone holds no data, nothing to ask. */
type SignOutAsk = { kind: 'empty' } | { kind: 'offer-delete' } | { kind: 'warn-keep'; reason: KeepReason; pending: PendingLocal };

/** "3 workouts, 120 step and sleep rows": what only this phone has, in the words the Cloud settings use. */
function pendingText(t: TFunction<'settings'>, pending: PendingLocal): string {
  const parts = [
    pending.workouts > 0 ? t('signOut.pending.workouts', { count: pending.workouts, n: formatCount(pending.workouts) }) : null,
    pending.rows > 0 ? t('signOut.pending.rows', { count: pending.rows, n: formatCount(pending.rows) }) : null,
    pending.strength > 0 ? t('signOut.pending.strength', { count: pending.strength, n: formatCount(pending.strength) }) : null,
    pending.records > 0 ? t('signOut.pending.records', { count: pending.records, n: formatCount(pending.records) }) : null,
  ].filter((part): part is string => part !== null);
  return parts.join(', ');
}

interface AccountDialogs {
  askSignOut: () => void;
  askDelete: () => void;
  /** Render once, anywhere on the screen. */
  dialogs: ReactNode;
}

/**
 * The two account-level actions of the Settings hub, each behind its own dialog: sign out, and delete the JoyoRogo account
 * (which also wipes its cloud data, never this phone's). The one implementation of both; "Delete cloud data", which keeps
 * the account, lives with the cloud settings.
 *
 * Signing out never deletes the phone's data unasked. A Pro account whose data is all in the cloud is offered the deletion
 * (the primary button, with "keep on this phone" next to it). A free account, an unfinished sync or anything waiting to upload
 * gets a warning that the data exists only here: keep is the primary button and the delete button says it cannot be undone.
 */
export function useAccountDialogs(): AccountDialogs {
  const { t } = useTranslation('settings');
  const cloud = useCloud();
  const db = useSQLiteContext();
  const [signOutAsk, setSignOutAsk] = useState<SignOutAsk | null>(null);
  const [checkingSignOut, setCheckingSignOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Set once a delete has been tried, so a failure shows its reason inside the dialog that stays open.
  const [tried, setTried] = useState(false);
  const withApple = isIos && cloud.appleAvailable;

  const closeDelete = () => {
    setDeleting(false);
    setTried(false);
  };

  /** Reads what exists only on this phone right now, then opens the dialog that fits. */
  const askSignOut = async () => {
    if (checkingSignOut) return;
    setCheckingSignOut(true);
    try {
      if (!(await hasLocalData(db))) {
        setSignOutAsk({ kind: 'empty' });
        return;
      }
      const [overview, strength, records] = await Promise.all([
        loadOverview(db, APP_BUILD),
        countDirtyStrength(db),
        recordSyncPending(db),
      ]);
      const pending: PendingLocal = {
        rows: overview.pendingRows,
        workouts: overview.pendingWorkouts + overview.refusedWorkouts,
        strength,
        records,
      };
      const facts = { pro: cloud.pro, synced: cloud.lastSyncAt !== null && cloud.error === null, pending };
      setSignOutAsk(signOutPlan(facts) === 'offer-delete' ? { kind: 'offer-delete' } : { kind: 'warn-keep', reason: keepReason(facts), pending });
    } catch {
      // Cannot tell what is only here: the careful warning, never the offer to delete.
      setSignOutAsk({ kind: 'warn-keep', reason: 'unsynced', pending: { rows: 0, workouts: 0, strength: 0, records: 0 } });
    } finally {
      setCheckingSignOut(false);
    }
  };

  const closeSignOut = () => setSignOutAsk(null);
  const signOut = (deleteLocalData: boolean) => {
    closeSignOut();
    void cloud.signOut({ deleteLocalData });
  };

  const warnMessage = (ask: Extract<SignOutAsk, { kind: 'warn-keep' }>): string => {
    const why =
      ask.reason === 'free'
        ? t('signOut.warnFree')
        : ask.reason === 'pending'
          ? t('signOut.warnPending')
          : t('signOut.warnUnsynced');
    return [why, pendingTotal(ask.pending) > 0 ? t('signOut.warnAmount', { amount: pendingText(t, ask.pending) }) : null, t('signOut.warnDelete')]
      .filter(Boolean)
      .join(' ');
  };

  const deleteMessage = [t('cloud.deleteWarning'), withApple ? t('cloud.deleteApple') : null, tried && !cloud.deleting ? cloud.error : null]
    .filter(Boolean)
    .join(' ');

  const dialogs = (
    <>
      <ConfirmDialog
        visible={signOutAsk?.kind === 'empty'}
        title={t('account.signOutTitle')}
        message={t('signOut.emptyMessage')}
        confirmLabel={t('cloud.signOut')}
        destructive
        onConfirm={() => signOut(false)}
        onCancel={closeSignOut}
      />
      <ChoiceDialog
        visible={signOutAsk?.kind === 'offer-delete'}
        title={t('signOut.offerTitle')}
        message={t('signOut.offerMessage')}
        choices={[
          { label: t('signOut.offerDelete'), variant: 'primary', onPress: () => signOut(true) },
          { label: t('signOut.keep'), variant: 'secondary', onPress: () => signOut(false) },
        ]}
        onCancel={closeSignOut}
      />
      <ChoiceDialog
        visible={signOutAsk?.kind === 'warn-keep'}
        title={t('signOut.warnTitle')}
        message={signOutAsk?.kind === 'warn-keep' ? warnMessage(signOutAsk) : ''}
        choices={[
          { label: t('signOut.keep'), variant: 'primary', onPress: () => signOut(false) },
          { label: t('signOut.warnDeleteLabel'), variant: 'destructive', onPress: () => signOut(true) },
        ]}
        onCancel={closeSignOut}
      />
      <ConfirmDialog
        visible={deleting}
        title={t('account.deleteTitle')}
        message={deleteMessage}
        confirmLabel={t('cloud.deletePermanently')}
        destructive
        busy={cloud.deleting}
        onConfirm={() => {
          setTried(true);
          void cloud.deleteAccount().then((deleted) => deleted && closeDelete());
        }}
        onCancel={closeDelete}
      />
    </>
  );

  return { askSignOut: () => void askSignOut(), askDelete: () => setDeleting(true), dialogs };
}
