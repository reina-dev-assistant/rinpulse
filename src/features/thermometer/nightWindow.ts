/** From this local hour on, opening the app counts as "going to bed" for the automatic overnight scan. */
export const EVENING_START_HOUR = 19;
/** The native side ends any capture at most this long after it started. */
export const MAX_CAPTURE_MS = 18 * 3_600_000;

/** The next time the clock reads `wakeHour`:00 after `now`, epoch ms. */
export function nextWakeTime(now: Date, wakeHour: number): number {
  const end = new Date(now);
  end.setHours(wakeHour, 0, 0, 0);
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return end.getTime();
}

/** When a capture started now ends: the coming `wakeHour`:00, but never more than {@link MAX_CAPTURE_MS} ahead. */
export function captureEnd(now: Date, wakeHour: number): number {
  return Math.min(nextWakeTime(now, wakeHour), now.getTime() + MAX_CAPTURE_MS);
}

/** What the native scan reports of itself (`RoomCaptureState`), the part the decision needs. */
export interface CaptureStatus {
  active: boolean;
  userStoppedAt: number | null;
}

/**
 * The end time to start the overnight scan with when the app is opened, or null to leave it. It starts only in the evening-to-morning
 * window (from 19:00 until `wakeHour`), never while one runs, and not for a night the person already stopped (the Stop button, or Stop in
 * Settings, at any time since 18 hours before the coming wake-up).
 */
export function autoArmEnd(now: Date, wakeHour: number, status: CaptureStatus): number | null {
  if (status.active) return null;
  const hour = now.getHours();
  if (!(hour >= EVENING_START_HOUR || hour < wakeHour)) return null;
  const end = captureEnd(now, wakeHour);
  if (status.userStoppedAt !== null && status.userStoppedAt > nextWakeTime(now, wakeHour) - MAX_CAPTURE_MS) return null;
  return end;
}
