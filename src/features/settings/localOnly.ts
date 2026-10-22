import Storage from 'expo-sqlite/kv-store';

/**
 * Local-only mode: this phone is the whole app.
 *
 * Rinpulse is used by one person on one phone. Everything it does — watch sync, health, sleep, workouts,
 * plans, the own-key AI — runs on this device, so the JoyoRogo account is only ever needed for the parts
 * that are *stored on their server* (cloud backup, the hosted AI engine, Family, the social feed).
 *
 * With this on, every sign-in surface is hidden: the account rows, the "Masuk" buttons in Settings, the
 * setup guide and the social/family gates. It does not fake a session, and it does not touch Pro gating —
 * a screen that needs the server still says so honestly instead of erroring at a button press.
 *
 * Default: **on.** A self-built APK is a local app; turning it off is for someone who wants the account
 * features back, and the switch is in Settings > Advanced.
 */
const KEY = 'rinpulse.localOnly';

/** Read once per launch: the value cannot change while a screen is mounted, and re-reading it on every render is wasteful. */
let cached = true;
let read = false;

export function localOnlyMode(): boolean {
  if (!read) {
    try {
      cached = Storage.getItemSync(KEY) !== '0';
    } catch {
      cached = true;
    }
    read = true;
  }
  return cached;
}

export function setLocalOnlyMode(enabled: boolean): void {
  cached = enabled;
  read = true;
  Storage.setItemSync(KEY, enabled ? '1' : '0');
}

/** Tests only: forget the cached value so the next read hits the store. */
export function resetLocalOnlyCache(): void {
  read = false;
}
