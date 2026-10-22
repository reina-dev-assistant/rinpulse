/** Keeps the running guide (`joyofit.lactateGuide`) and schedules the three local notifications that call the phases while the app is not in front. */
import * as Notifications from 'expo-notifications';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import { t } from '@/i18n';

import { GUIDE_CUES, parseGuide, type Guide } from './guide';

const KEY = 'joyofit.lactateGuide';
const CHANNEL_ID = 'lactate-guide';
const idOf = (cue: string) => `lactate-guide-${cue}`;

export function getGuide(nowMs: number = Date.now()): Guide | null {
  return parseGuide(Storage.getItemSync(KEY), nowMs);
}

async function cancelCues(): Promise<void> {
  for (const cue of GUIDE_CUES) {
    try {
      await Notifications.cancelScheduledNotificationAsync(idOf(cue.key));
    } catch {
      // nothing scheduled
    }
  }
}

/** Starts the guide now. The cues need the notification permission; without it the guide still works on screen. Resolves with whether cues were scheduled. */
export async function startGuide(nowMs: number = Date.now()): Promise<boolean> {
  Storage.setItemSync(KEY, JSON.stringify({ startedAt: nowMs }));
  try {
    let granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: t('health:lactate.cues.channel'), importance: Notifications.AndroidImportance.HIGH });
    }
    await cancelCues();
    for (const cue of GUIDE_CUES) {
      await Notifications.scheduleNotificationAsync({
        identifier: idOf(cue.key),
        content: { title: t(`health:lactate.cues.${cue.key}.title`), body: t(`health:lactate.cues.${cue.key}.body`) },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: cue.afterSec, channelId: CHANNEL_ID },
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function stopGuide(): Promise<void> {
  Storage.removeItemSync(KEY);
  await cancelCues();
}
