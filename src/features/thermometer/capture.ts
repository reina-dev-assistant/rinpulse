import { t } from '@/i18n';

import type { RoomCaptureNative } from './roomNative';

/** Starts the overnight scan until `untilMs`, with the notification in the app's language. Android store build only (`roomCaptureNative()`). */
export async function startNightCapture(native: RoomCaptureNative, ids: readonly string[], untilMs: number): Promise<void> {
  await native.startRoomCapture({
    ids: [...ids],
    untilMs,
    title: t('thermometer:capture.notification.title'),
    text: t('thermometer:capture.notification.text'),
    stopLabel: t('thermometer:capture.notification.stop'),
  });
}
