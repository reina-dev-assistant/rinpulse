/**
 * Pauses every upload and pull of the phone's data while a person is deciding what happens to the data of an earlier
 * account (`AccountSwitchDialog`) or while it is being deleted at sign-out. The sync entry points that are not driven by
 * `CloudProvider.syncNow` (the debounced strength sync after a save, the energy sent to JoyoRogo's diary, the record
 * sync) check it too, because the session is already the new account's: whatever ran now would send the old data to it.
 * Held in memory on purpose: after a restart the provider finds the same account mismatch again and pauses again.
 */
let paused = false;

export function pauseSync(): void {
  paused = true;
}

export function resumeSync(): void {
  paused = false;
}

export function isSyncPaused(): boolean {
  return paused;
}
