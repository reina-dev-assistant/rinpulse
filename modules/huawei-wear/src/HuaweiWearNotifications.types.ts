/**
 * The ways the per-app notification switch (02/0B) can be written, which the iOS filter test chooses between (docs/ios-notification-app-switches.md):
 * `A` iOS bundle id, 1 = off; `B` bundle id, 0 = off; `C1` Huawei's own catalogue number, 1 = off; `C2` the number, 0 = off.
 */
export type NotificationFilterEncoding = 'A' | 'B' | 'C1' | 'C2';

/** One row of the iOS list. `packageName` is the iOS bundle id, or `other` for every app that has no row of its own. */
export interface NotificationFilterApp {
  packageName: string;
  /** The app's name; `Other` for the last row (the screen words it). */
  label: string;
  /** The person's switch; on unless they turned it off. */
  enabled: boolean;
  /** The proven encoding has an id for this app. False for every app until a test proved an encoding. */
  sendable: boolean;
}

/**
 * Where the filter test stands. `probe`: one app was switched off with `candidate` and the person says whether a message from it still reaches the
 * watch. `confirm`: it was switched back and the person says whether a message comes through again. `finished`: `outcome` and `report` are set.
 */
export interface NotificationFilterTest {
  phase: 'probe' | 'confirm' | 'finished';
  /** Bundle id of the app under test. */
  app: string;
  candidate: NotificationFilterEncoding | null;
  /** Position of `candidate` among the candidates tried for this app (1-based), and how many there are. */
  step: number;
  steps: number;
  /**
   * `winner`: an encoding hid the app and let it through once switched back (stored). `none`: no candidate hid it. `inconclusive`: it was hidden but
   * did not come back. `cancelled`: the person left; the app was switched back. `failed`: the watch did not take a packet, or the link dropped.
   */
  outcome: 'winner' | 'none' | 'inconclusive' | 'cancelled' | 'failed' | null;
  /** The one line that went to the support log (no message content), set when finished. */
  report: string | null;
}

/** `getNotificationFilter` (iOS only). */
export interface NotificationFilterStatus {
  /** A watch is connected now. */
  connected: boolean;
  /** The connected watch lists the app switches (ExpandCapability 161). */
  gate: boolean;
  /** iOS shares the iPhone's notifications with the watch (ANCS). Without it there is nothing to filter. */
  ancs: boolean;
  /** The encoding a test proved on this phone; null until then, and the switches stay disabled. */
  encoding: NotificationFilterEncoding | null;
  apps: NotificationFilterApp[];
  /** The running test, or the last finished one until the next starts. */
  test: NotificationFilterTest | null;
  /** A test was interrupted with an app switched off: it is switched back at the next connect. */
  restorePending: boolean;
  /** The last finished test's report line. */
  report: string | null;
}
