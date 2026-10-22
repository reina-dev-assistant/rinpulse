import { MIN_ADULT_AGE } from './person';
import { consentFor } from './consent';
import type { AiSettings } from './settings';
import { isInsecureRemote, normalizeBaseUrl, PROVIDERS } from './providers';
import type { ProviderId } from './types';

/** Why the phone will not call the person's own provider; nothing is sent while this is set. */
export type ByokBlock = 'minor' | 'noProvider' | 'badUrl' | 'noKey' | 'noConsent';

export type ByokAccess = { ok: true; provider: ProviderId; baseUrl: string; model: string } | { ok: false; reason: ByokBlock };

/** The endpoint of a provider as the phone calls it: the preset, or the custom URL the person typed. Null when that URL is unusable. */
export function baseUrlFor(settings: AiSettings, provider: ProviderId): string | null {
  return PROVIDERS[provider].customUrl ? normalizeBaseUrl(settings.customBaseUrl) : PROVIDERS[provider].baseUrl;
}

export function modelFor(settings: AiSettings, provider: ProviderId): string {
  return settings.models[provider] ?? PROVIDERS[provider].defaultModel;
}

/**
 * The one gate in front of every provider call (chat, insight, key test never pass it: a test sends no health data).
 * Under 18 is off whatever else is set; a known age below 18 comes from the profile on the phone or in JoyoRogo.
 * An unknown age is allowed, the person confirmed 18+ in the consent, and the prompt then uses the conservative block.
 */
export function byokAccess(settings: AiSettings, ageYears: number | null): ByokAccess {
  if (ageYears !== null && ageYears < MIN_ADULT_AGE) return { ok: false, reason: 'minor' };
  const provider = settings.provider;
  if (!provider) return { ok: false, reason: 'noProvider' };
  const baseUrl = baseUrlFor(settings, provider);
  if (!baseUrl || isInsecureRemote(baseUrl)) return { ok: false, reason: 'badUrl' };
  if (!settings.keySaved[provider]) return { ok: false, reason: 'noKey' };
  if (!consentFor(settings, provider, baseUrl)) return { ok: false, reason: 'noConsent' };
  return { ok: true, provider, baseUrl, model: modelFor(settings, provider) };
}
