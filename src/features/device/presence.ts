/**
 * Whether this phone has a watch in its life, as one word. Many people open JoyoFit for the strength logger and own no watch (or a
 * model that cannot be paired); screens that only make sense with a watch hide behind this instead of showing empty cards.
 *
 * - `watch`: a watch is linked now, remembered for the background link, or was connected before (a `device` row).
 * - `data`: no watch, but watch-like data is stored (a Huawei Health or FIT import, a Health export), so the data screens have something to show.
 * - `none`: neither. Today, Workouts and Settings drop their watch cards and show one "Connect a watch" prompt.
 */
export type WatchPresence = 'none' | 'data' | 'watch';

export interface PresenceFacts {
  /** `HuaweiWear.getDevice() !== null`. */
  linked: boolean;
  /** `HuaweiWear.getBackgroundStatus().address !== null`. */
  remembered: boolean;
  /** A `device` row exists. */
  stored: boolean;
  /** Steps, sleep or a watch workout are stored. */
  hasData: boolean;
}

export function presenceOf(facts: PresenceFacts): WatchPresence {
  if (facts.linked || facts.remembered || facts.stored) return 'watch';
  return facts.hasData ? 'data' : 'none';
}

/** The watch-only parts of a screen show for `watch` and for `data`; only `none` hides them. */
export function showsWatchUi(presence: WatchPresence): boolean {
  return presence !== 'none';
}
