import type { NotificationFilterApp, NotificationFilterStatus } from '@/wear';

/** The app the filter test starts with: the one every iPhone has, and the one Huawei's own numbering covers (a fourth and fifth candidate). */
export const DEFAULT_TEST_APP = 'com.apple.MobileSMS';

/** The key of the catch-all row. */
export const OTHER_APP = 'other';

/** Why the test cannot start now, in the order the person fixes it; null when it can. */
export type TestBlock = 'disconnected' | 'noGate' | 'noAncs' | null;

/** A test is on the watch and waiting for an answer. */
export function isTestRunning(status: NotificationFilterStatus): boolean {
  return status.test !== null && status.test.phase !== 'finished';
}

export function testBlock(status: NotificationFilterStatus): TestBlock {
  if (!status.connected) return 'disconnected';
  if (!status.gate) return 'noGate';
  if (!status.ancs) return 'noAncs';
  return null;
}

/** The per-app switches work only once a test proved how the watch takes the list, and not while one is running. */
export function switchesEnabled(status: NotificationFilterStatus): boolean {
  return status.encoding !== null && !isTestRunning(status);
}

/** One row's switch: the proven encoding must have an id for the app. */
export function rowEnabled(status: NotificationFilterStatus, app: NotificationFilterApp): boolean {
  return switchesEnabled(status) && app.sendable;
}

/** Apps the test can use: every row but the catch-all, which is no app a message can come from. */
export function testableApps(status: NotificationFilterStatus): NotificationFilterApp[] {
  return status.apps.filter((app) => app.packageName !== OTHER_APP);
}
