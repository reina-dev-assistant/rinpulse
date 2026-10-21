import type { LocalePref } from '@/i18n/locale';
import { HuaweiWear } from '@/wear';

/**
 * Hands the "Bahasa" choice to the native module (the pinned language, or `null` for "Otomatis" so the phone's language is used), which
 * sends it to the watch at every connect and now when one is linked. A build from before `setWatchLanguage` (an update onto an older
 * binary) skips it; a failure is not shown: the next connect sends the stored language anyway.
 */
export async function syncWatchLanguage(pref: LocalePref): Promise<void> {
  if (typeof HuaweiWear.setWatchLanguage !== 'function') return;
  try {
    await HuaweiWear.setWatchLanguage(pref === 'auto' ? null : pref);
  } catch {
    // Stored natively or not; the watch gets it at the next connect.
  }
}
