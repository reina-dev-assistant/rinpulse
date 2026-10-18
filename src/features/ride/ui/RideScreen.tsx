import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { FinishDialog } from '@/features/record/ui/FinishDialog';
import { LiveView } from '@/features/record/ui/LiveView';
import { holdScreenOn, releaseScreen } from '@/features/strength/keepAwake';
import { errorMessage } from '@/format';
import { useRecorder } from '@/state/RecorderProvider';
import { useRide } from '@/state/RideProvider';
import { useSensors } from '@/state/SensorsProvider';
import { useStrava } from '@/state/StravaProvider';
import { spacing } from '@/theme';

import { GameCard } from './GameCard';
import { JoinView } from './JoinView';
import { StatusCard } from './StatusCard';
import { inRoom } from './format';

/** The tag this screen holds the screen on under, so other holds are not released with it. */
const KEEP_AWAKE_TAG = 'ride';

type Dialog = 'finish' | 'discard' | 'leave' | null;

/**
 * "Main di web". Not in a room: the join form. In a room: the connection status, then the recorder's own screens (ready, live) with the
 * game's figures on top. The room and the recording live in providers, so leaving the screen keeps both going; only "Keluar dari ruang"
 * leaves the room. The phone stays the source of truth: the game's stop request only opens the save dialog.
 */
export function RideScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { snapshot } = useRide();
  if (!inRoom(snapshot.phase)) return <Screen><JoinView initialCode={code ?? ''} /></Screen>;
  return <RoomView />;
}

function RoomView() {
  const { t } = useTranslation(['ride', 'workouts']);
  const router = useRouter();
  const ride = useRide();
  const { snapshot: room } = ride;
  const { snapshot: rec, pause, resume } = useRecorder();
  const { saved } = useSensors();
  const { settings } = useStrava();
  const stravaAvailable = settings.connectedAt !== null;

  const [dialog, setDialog] = useState<Dialog>(null);
  const [strava, setStrava] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void holdScreenOn(KEEP_AWAKE_TAG);
    return () => {
      void releaseScreen(KEEP_AWAKE_TAG);
    };
  }, []);

  // The game ended the ride: the phone is already paused, the save dialog opens by itself and the person decides.
  const active = rec.phase === 'active';
  const shown: Dialog = dialog ?? (room.stopRequested && active ? 'finish' : null);

  const askFinish = () => {
    if (rec.status === 'recording') pause();
    setDialog('finish');
  };

  const keepGoing = () => {
    setDialog(null);
    ride.dismissStop();
    if (rec.status === 'paused') resume();
  };

  const save = async () => {
    setSaveError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await ride.finish({ strava: stravaAvailable && strava });
      setDialog(null);
      if (result) {
        setLeaving(true);
        await ride.leave();
        router.replace({ pathname: '/workouts/[id]', params: { id: String(result.workoutId) } });
      } else {
        setNotice(t('workouts:record.finish.nothing'));
      }
    } catch (e) {
      setDialog(null);
      ride.dismissStop();
      setSaveError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDiscard = async () => {
    setBusy(true);
    try {
      await ride.discard();
      setDialog(null);
      setSaveError(null);
    } catch {
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const confirmLeave = async () => {
    setDialog(null);
    await ride.leave();
  };

  if (leaving) return <Screen><AppText variant="caption" muted>{t('ride:status.connecting')}</AppText></Screen>;

  const sensorsPaired = saved.some((s) => s.autoConnect);
  const lost = room.phase === 'lost';

  return (
    <>
      <Screen>
        <StatusCard snapshot={room} />

        {room.error && room.phase !== 'joining' ? (
          <Notice tone="danger" action={lost ? { label: t('ride:actions.reconnect'), onPress: ride.reconnect } : undefined}>
            {t(`ride:error.${room.error.kind}`)}
          </Notice>
        ) : null}
        {notice ? <Notice icon="information-circle">{notice}</Notice> : null}
        {room.stopRequested && active ? <Notice icon="flag">{t('ride:actions.stopAsked')}</Notice> : null}

        {rec.phase === 'ready' ? (
          <Section title={t('ride:lobby.title')} icon="play-circle" tint="link">
            <AppText variant="caption" muted>
              {t('ride:lobby.hint')}
            </AppText>
            {!sensorsPaired ? (
              <Notice icon="bluetooth" action={{ label: t('ride:lobby.manageSensors'), onPress: () => router.push('/watch/sensors') }}>
                {t('ride:lobby.noSensors')}
              </Notice>
            ) : null}
            <Button label={t('ride:lobby.start')} variant="primary" icon="play" style={styles.start} onPress={ride.start} />
          </Section>
        ) : null}
        {rec.phase === 'idle' && !room.error ? (
          <AppText variant="caption" muted>
            {t('ride:lobby.preparing')}
          </AppText>
        ) : null}

        {rec.phase === 'active' || rec.phase === 'saving' ? (
          <>
            <GameCard game={room.game} onGear={ride.gear} />
            <LiveView saving={rec.phase === 'saving'} saveError={saveError} onFinish={askFinish} onSaveAgain={() => void save()} onDiscard={() => setDialog('discard')} />
          </>
        ) : null}

        <Button
          label={t('ride:actions.leave')}
          icon="exit-outline"
          disabled={rec.phase === 'saving'}
          onPress={() => (rec.phase === 'active' ? setDialog('leave') : void ride.leave())}
        />
      </Screen>
      <FinishDialog
        visible={shown === 'finish'}
        live={rec.live}
        stravaAvailable={stravaAvailable}
        strava={strava}
        onStrava={setStrava}
        busy={busy}
        onSave={() => void save()}
        onResume={keepGoing}
        onDiscard={() => setDialog('discard')}
      />
      <ConfirmDialog
        visible={dialog === 'discard'}
        title={t('workouts:record.finish.discardTitle')}
        message={t('workouts:record.finish.discardMessage')}
        confirmLabel={t('workouts:record.finish.discardConfirm')}
        destructive
        busy={busy}
        onConfirm={() => void confirmDiscard()}
        onCancel={() => setDialog(rec.status === 'finished' ? null : 'finish')}
      />
      <ConfirmDialog
        visible={dialog === 'leave'}
        title={t('ride:actions.leaveTitle')}
        message={t('ride:actions.leaveMessage')}
        confirmLabel={t('ride:actions.leaveConfirm')}
        onConfirm={() => void confirmLeave()}
        onCancel={() => setDialog(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  start: { minHeight: 56, marginTop: spacing.xs },
});
