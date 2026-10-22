import { hostOf } from './providers';
import type { AiSettings, ConsentRecord, SettingsStore } from './settings';
import type { ProviderId } from './types';

/**
 * The version of the consent text and of the list of data the digest sends. Change the digest fields (`DIGEST_FIELDS`) and this
 * number together: `digest.test.ts` pins the field list to the version, so a changed list without a new version fails the build,
 * and everyone is asked again (Apple 5.1.2(i), Google Play's AI user-data rules).
 */
export const CONSENT_VERSION = 2;

/** The kinds of data that leave the phone, in the order the consent screen lists them (`ai:consent.data.<id>`). */
export const CONSENT_CATEGORIES = ['body', 'sleep', 'recovery', 'heart', 'workouts', 'plan', 'food', 'notes', 'chat'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export function consentFor(settings: AiSettings, provider: ProviderId, baseUrl: string): ConsentRecord | null {
  const record = settings.consents[provider];
  if (!record || record.version !== CONSENT_VERSION) return null;
  return record.host === hostOf(baseUrl) ? record : null;
}

export const hasConsent = (settings: AiSettings, provider: ProviderId, baseUrl: string): boolean => consentFor(settings, provider, baseUrl) !== null;

/** Records the yes of one person for one provider endpoint (explicit tap, plus "I am 18 or older"). */
export function grantConsent(store: SettingsStore, provider: ProviderId, baseUrl: string, nowSec: number): void {
  store.update((s) => ({ consents: { ...s.consents, [provider]: { version: CONSENT_VERSION, at: nowSec, host: hostOf(baseUrl), adult: true as const } } }));
}

/** Removes the yes of one provider (the key is deleted by the caller: `deleteProvider`). */
export function revokeConsent(store: SettingsStore, provider: ProviderId): void {
  store.update((s) => {
    const { [provider]: _removed, ...rest } = s.consents;
    return { consents: rest };
  });
}
