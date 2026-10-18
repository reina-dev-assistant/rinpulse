import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { gpsStatus } from '@/features/record/ui/format';
import { fmtInt } from '@/i18n';
import { useRecorder } from '@/state/RecorderProvider';
import { useTheme } from '@/theme';

import { alertText } from '../alertPresenter';
import { useBikeRide, useRideDimming } from '../useBikeRide';
import { isUrgentAlert } from './AlertBanner';
import { lockPortrait, unlockRideOrientation } from './orientation';
import { RideButton } from './RideButton';
import { RideFrame, type FrameAlert } from './RideFrame';
import { RidePageContent } from './RidePageContent';
import { resolveRideTheme, ridePalette } from './ridePalette';
import { useBikeLayout, useBikeSettings } from './useBikeSettings';

interface BikeRideViewProps {
  /** The recording is being written to the database. */
  saving: boolean;
  /** Why the last save failed; the recording is still held and can be saved again. */
  saveError: string | null;
  onFinish: () => void;
  onSaveAgain: () => void;
  onDiscard: () => void;
}

/**
 * The live ride screen of bike computer mode, shown instead of `LiveView` while the mode is on and the sport is Ride: paged data screens,
 * a map, a climb page and a laps page, alerts, and a fixed control bar. Full screen (not inside a `Screen`).
 */
export function BikeRideView({ saving, saveError, onFinish, onSaveAgain, onDiscard }: BikeRideViewProps) {
  const { t } = useTranslation('bikecomp');
  const { scheme, fonts } = useTheme();
  const settings = useBikeSettings();
  const layout = useBikeLayout();
  const ride = useBikeRide();
  const { snapshot, pause, resume, lap } = useRecorder();
  const { touch } = useRideDimming();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const landscape = width > height;
  const palette = ridePalette(resolveRideTheme(settings.theme, scheme));
  const { live } = snapshot;

  // The ride screen may rotate; both calls do nothing in a binary without the module.
  useEffect(() => {
    void unlockRideOrientation();
    return () => void lockPortrait();
  }, []);

  const laps = useMemo(
    () => snapshot.laps.map((l, i) => ({ number: i + 1, distanceM: l.distanceM, movingSec: l.movingSec, avgHr: l.avgHr })),
    [snapshot.laps],
  );

  if (!live || !snapshot.sport) return null;

  const failed = live.status === 'finished' && !saving;
  const { nav, alert } = ride;

  if (failed) {
    return (
      <View style={[styles.failed, { backgroundColor: palette.background, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <StatusBar style={palette.theme === 'day' ? 'dark' : 'light'} />
        <Text accessibilityRole="alert" style={[styles.failedText, { color: palette.foreground, fontFamily: fonts.heavy }]}>
          {t('save.failed', { error: saveError ?? '--' })}
        </Text>
        <RideButton label={t('save.again')} icon="refresh" variant="filled" palette={palette} onPress={onSaveAgain} />
        <RideButton label={t('save.discard')} icon="trash-outline" variant="outline" palette={palette} onPress={onDiscard} />
      </View>
    );
  }

  const { saver } = ride;
  const pct = ride.batteryPct === null ? '--' : fmtInt(Math.round(ride.batteryPct));
  // The battery saver turns the map page off. Never leave the rider without a page.
  const shown = saver.active ? layout.pages.filter((p) => p.kind !== 'map') : layout.pages;
  const pages = shown.length > 0 ? shown : layout.pages;

  const frameAlert: FrameAlert | null =
    alert && !(alert.kind === 'offCourse' && nav?.offCourse)
      ? { key: alert.at, text: alertText(alert), tone: isUrgentAlert(alert.kind) ? 'urgent' : 'quiet', onDismiss: ride.dismissAlert }
      : saver.prompt === 'forced'
        ? { key: 'saver-forced', text: t('saver.forced', { pct }), tone: 'quiet', onDismiss: saver.dismiss }
        : null;
  const offCourseText = nav?.offCourse
    ? nav.offCourseM !== null
      ? t('offCourse.banner', { meters: fmtInt(Math.round(nav.offCourseM)) })
      : t('offCourse.bannerNoDistance')
    : null;

  return (
    <>
      <StatusBar style={palette.theme === 'day' ? 'dark' : 'light'} />
      <RideFrame
        palette={palette}
        landscape={landscape}
        insets={insets}
        status={{
          gps: snapshot.gps && ride.gps ? gpsStatus(ride.gps) : snapshot.gps ? 'searching' : null,
          accuracyM: ride.gps?.accuracyM ?? null,
          sensorsLost: ride.sensorsLost,
          batteryPct: ride.batteryPct,
          recording: live.status === 'recording',
          paused: ride.paused && !ride.autoPaused,
          autoPaused: ride.autoPaused,
          saver: saver.active ? t('saver.active') : null,
        }}
        pages={pages}
        renderPage={(page, active, pageWidth) => (
          <RidePageContent
            page={page}
            active={active}
            width={pageWidth}
            palette={palette}
            ctx={ride.ctx}
            nav={nav}
            hasRoute={ride.hasRoute}
            elevation={ride.elevation}
            route={ride.route}
            position={ride.position}
            laps={laps}
          />
        )}
        controls={{ paused: ride.paused, saving, onTogglePause: ride.paused ? resume : pause, onLap: lap, onFinish }}
        alert={frameAlert}
        offCourseText={offCourseText}
        onTouch={touch}
      />
      <ConfirmDialog
        visible={saver.prompt === 'propose'}
        title={t('saver.title')}
        message={t('saver.proposal', { pct })}
        confirmLabel={t('saver.accept')}
        cancelLabel={t('saver.dismiss')}
        onConfirm={saver.accept}
        onCancel={saver.dismiss}
      />
    </>
  );
}

const styles = StyleSheet.create({
  failed: { flex: 1, justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  failedText: { fontSize: 22, lineHeight: 30, marginBottom: 8 },
});
