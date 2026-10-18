import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { StravaNotConnectedError } from '@/cloud/strava';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import type { StravaUploadRow } from '@/db/strava';
import { ShareStrengthSheet } from '@/features/stickers/ui/ShareStrengthButton';
import { ViewOnStrava } from '@/features/strava/StravaLink';
import { errorMessage } from '@/format';
import { useStrava } from '@/state/StravaProvider';

import type { PersonalRecord } from '../calc';
import type { Catalog } from '../catalog';
import { sendStrengthToStrava, strengthStravaStatus } from '../strava';
import type { StrengthWorkout } from '../types';

interface Props {
  workout: StrengthWorkout;
  catalog: Catalog;
  records: PersonalRecord[];
}

/**
 * Share card and Strava upload of a finished strength workout. Nothing for a workout without a `workouts` row (history imported
 * from JoyoRogo): there is no activity to send. Sending is allowed for any workout; only the automatic upload is limited to new ones.
 */
export function StrengthActions({ workout, catalog, records }: Props): ReactElement {
  const { t } = useTranslation(['strengthshare', 'sharing', 'common']);
  const db = useSQLiteContext();
  const router = useRouter();
  const strava = useStrava();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [row, setRow] = useState<StravaUploadRow | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = strava.settings.connectedAt !== null;
  const stored = workout.workoutStart !== null;

  useFocusEffect(
    useCallback(() => {
      let live = true;
      strengthStravaStatus(db, workout).then(
        (found) => {
          if (live) setRow(found);
        },
        () => {},
      );
      return () => {
        live = false;
      };
    }, [db, workout]),
  );

  const send = useCallback(async () => {
    setError(null);
    setSending(true);
    try {
      const sent = await sendStrengthToStrava(db, workout);
      if (sent) setRow(sent);
    } catch (e) {
      setError(e instanceof StravaNotConnectedError ? e.message : errorMessage(e));
      await strava.refresh().catch(() => {});
    } finally {
      setSending(false);
    }
  }, [db, workout, strava]);

  if (!stored) return <></>;

  const done = row?.status === 'done' && row.activityId !== null;

  return (
    <Section title={t('strengthshare:actions.title')} icon="share-social" tint="workouts">
      <Button label={t('common:actions.share')} icon="share-outline" onPress={() => setSheetOpen(true)} />
      <ShareStrengthSheet workout={workout} catalog={catalog} records={records} visible={sheetOpen} onClose={() => setSheetOpen(false)} />

      {!connected ? (
        <>
          <AppText variant="caption" muted>
            {t('strengthshare:actions.connectHint')}
          </AppText>
          <Button label={t('strengthshare:actions.connect')} variant="secondary" icon="link" onPress={() => router.push('/settings/strava')} />
        </>
      ) : (
        <>
          <KeyValue
            icon="cloud-upload-outline"
            label={t('sharing:strava.status')}
            value={row ? t(`sharing:strava.statuses.${row.status}`) : t('sharing:strava.notSent')}
          />
          {done ? <ViewOnStrava activityId={row.activityId as number} /> : null}
          {row && row.status !== 'done' && row.error ? <Notice tone="danger">{row.error}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {!done ? (
            <Button
              label={row?.status === 'processing' ? t('sharing:strava.check') : row?.status === 'failed' || row?.status === 'rejected' ? t('common:actions.retry') : t('sharing:strava.send')}
              variant="primary"
              icon="cloud-upload"
              onPress={() => void send()}
              disabled={!strava.signedIn}
              loading={sending}
            />
          ) : null}
          {!strava.signedIn ? (
            <AppText variant="caption" muted>
              {t('sharing:strava.signIn')}
            </AppText>
          ) : null}
        </>
      )}
    </Section>
  );
}
