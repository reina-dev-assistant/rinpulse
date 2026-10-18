/**
 * What an alert does outside the ride screen's banner: a vibration pattern, and a sound through a high-importance notification when the
 * rider turned sound on and the notification permission is already granted (a ride never opens a permission prompt). In-app beeps need
 * an audio module and are Later (docs/bike-computer.md section 6).
 */
import * as Notifications from 'expo-notifications';
import { Platform, Vibration } from 'react-native';

import { t } from '@/i18n';

import { alertPriority, vibrationPattern } from './ride/alerts';
import type { AlertConfig, RideAlert } from './types';

const CHANNEL_ID = 'bike-alert';
const IDENTIFIER = 'bike-alert';

let channelReady = false;

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: t('bikecomp:alert.channel'),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
  });
  channelReady = true;
}

/** The sentence of an alert, for the banner and the notification. */
export function alertText(alert: RideAlert): string {
  return t(`bikecomp:alert.${alert.kind}` as 'bikecomp:alert.eat', { value: alert.value ?? '' });
}

/** Fires the vibration and the sound of one alert as the settings ask. Never throws. */
export async function presentAlert(alert: RideAlert, config: Pick<AlertConfig, 'vibrate' | 'sound'>): Promise<void> {
  if (config.vibrate) {
    try {
      Vibration.vibrate(vibrationPattern(alert.kind));
    } catch {
      // no vibrator: the banner still shows
    }
  }
  // Information (a lap, a turn 300 m ahead) is not worth waking the pocket for.
  if (!config.sound || alertPriority(alert.kind) === 'info') return;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: IDENTIFIER,
      content: { title: alertText(alert), sound: true },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // a missed sound is not worth interrupting a ride for
  }
}

/** Takes the sound notification down once the ride is over. */
export async function clearAlertNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(IDENTIFIER);
  } catch {
    // nothing shown
  }
}
