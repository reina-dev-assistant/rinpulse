import { describe, expect, test } from 'bun:test';

import { byokAccess, baseUrlFor, modelFor } from './access';
import { CONSENT_CATEGORIES, CONSENT_VERSION, consentFor, grantConsent, hasConsent, revokeConsent } from './consent';
import { memoryKv } from './kv';
import { ageFromBirthYear, lowestAge, PROFILE_FRESH_SEC, profileIsFresh } from './person';
import { isInsecureRemote, normalizeBaseUrl, hostOf } from './providers';
import { createSettingsStore, DEFAULT_SETTINGS, parseSettings } from './settings';

const ready = () => {
  const store = createSettingsStore(memoryKv());
  store.update({ provider: 'openrouter', keySaved: { openrouter: true } });
  grantConsent(store, 'openrouter', 'https://openrouter.ai/api/v1', 1_700_000_000);
  return store;
};

describe('own-key gate', () => {
  test('a fresh install is closed and the engine is the hosted one', () => {
    expect(DEFAULT_SETTINGS.engine).toBe('rogo');
    expect(byokAccess(DEFAULT_SETTINGS, 30)).toEqual({ ok: false, reason: 'noProvider' });
  });

  test('open only with provider, key and consent; then returns the endpoint and the model', () => {
    const store = createSettingsStore(memoryKv());
    store.update({ provider: 'openrouter' });
    expect(byokAccess(store.get(), 30)).toEqual({ ok: false, reason: 'noKey' });
    store.update({ keySaved: { openrouter: true } });
    expect(byokAccess(store.get(), 30)).toEqual({ ok: false, reason: 'noConsent' });
    grantConsent(store, 'openrouter', 'https://openrouter.ai/api/v1', 1);
    expect(byokAccess(store.get(), 30)).toEqual({ ok: true, provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5' });
  });

  test('under 18 is closed whatever else is set, an unknown age is allowed', () => {
    const settings = ready().get();
    expect(byokAccess(settings, 17)).toEqual({ ok: false, reason: 'minor' });
    expect(byokAccess(settings, 0)).toEqual({ ok: false, reason: 'minor' });
    expect(byokAccess(settings, 18).ok).toBe(true);
    expect(byokAccess(settings, null).ok).toBe(true);
  });

  test('the lowest known age wins: a profile on the phone or in JoyoRogo saying under 18 closes it', () => {
    expect(lowestAge(30, 16)).toBe(16);
    expect(lowestAge(null, 17)).toBe(17);
    expect(lowestAge(null, null)).toBeNull();
    expect(ageFromBirthYear(2010, 2026)).toBe(16);
    expect(ageFromBirthYear(1800, 2026)).toBeNull();
    expect(ageFromBirthYear(2030, 2026)).toBeNull();
    expect(ageFromBirthYear(undefined, 2026)).toBeNull();
  });

  test('a cached JoyoRogo profile is trusted for 12 hours, so a slow server never delays a question', () => {
    expect(profileIsFresh(1000, 1000 + PROFILE_FRESH_SEC - 1)).toBe(true);
    expect(profileIsFresh(1000, 1000 + PROFILE_FRESH_SEC)).toBe(false);
    expect(profileIsFresh(2000, 1000)).toBe(false);
  });

  test('consent is per provider: another provider with a key but no yes stays closed', () => {
    const store = ready();
    store.update((s) => ({ provider: 'openai', keySaved: { ...s.keySaved, openai: true } }));
    expect(byokAccess(store.get(), 30)).toEqual({ ok: false, reason: 'noConsent' });
  });

  test('consent for an old version does not count: everyone is asked again', () => {
    const store = ready();
    store.update((s) => ({ consents: { openrouter: { ...s.consents.openrouter!, version: CONSENT_VERSION - 1 } } }));
    expect(byokAccess(store.get(), 30)).toEqual({ ok: false, reason: 'noConsent' });
  });

  test('a custom endpoint is a different recipient: changing the host needs a new yes', () => {
    const store = createSettingsStore(memoryKv());
    store.update({ provider: 'custom', customBaseUrl: 'https://gateway.example.com/v1', keySaved: { custom: true } });
    grantConsent(store, 'custom', 'https://gateway.example.com/v1', 1);
    expect(byokAccess(store.get(), 30).ok).toBe(true);
    store.update({ customBaseUrl: 'https://other.example.org/v1' });
    expect(byokAccess(store.get(), 30)).toEqual({ ok: false, reason: 'noConsent' });
  });

  test('a custom endpoint must be usable and not plain http across the internet', () => {
    const store = createSettingsStore(memoryKv());
    store.update({ provider: 'custom', keySaved: { custom: true }, customBaseUrl: 'not a url' });
    expect(byokAccess(store.get(), 30)).toEqual({ ok: false, reason: 'badUrl' });
    store.update({ customBaseUrl: 'http://api.example.com/v1' });
    expect(byokAccess(store.get(), 30)).toEqual({ ok: false, reason: 'badUrl' });
    store.update({ customBaseUrl: 'http://192.168.1.20:11434/v1' });
    grantConsent(store, 'custom', 'http://192.168.1.20:11434/v1', 1);
    expect(byokAccess(store.get(), 30).ok).toBe(true);
  });

  test('withdrawing the consent closes the gate again', () => {
    const store = ready();
    revokeConsent(store, 'openrouter');
    expect(hasConsent(store.get(), 'openrouter', 'https://openrouter.ai/api/v1')).toBe(false);
    expect(byokAccess(store.get(), 30)).toEqual({ ok: false, reason: 'noConsent' });
  });

  test('the consent record names the host and the adult confirmation', () => {
    const record = consentFor(ready().get(), 'openrouter', 'https://openrouter.ai/api/v1');
    expect(record).toMatchObject({ version: CONSENT_VERSION, host: 'openrouter.ai', adult: true, at: 1_700_000_000 });
    expect(CONSENT_CATEGORIES).toContain('food');
    expect(CONSENT_CATEGORIES).not.toContain('cycle' as never);
  });
});

describe('providers and settings', () => {
  test('URL helpers', () => {
    expect(normalizeBaseUrl(' https://x.example.com/v1/// ')).toBe('https://x.example.com/v1');
    expect(normalizeBaseUrl('ftp://x')).toBeNull();
    expect(hostOf('https://Gateway.Example.com/v1')).toBe('gateway.example.com');
    expect(isInsecureRemote('https://api.example.com')).toBe(false);
    expect(isInsecureRemote('http://api.example.com')).toBe(true);
    expect(isInsecureRemote('http://localhost:11434')).toBe(false);
    expect(isInsecureRemote('http://10.0.0.4:8080')).toBe(false);
    expect(isInsecureRemote('http://172.20.1.1')).toBe(false);
    expect(isInsecureRemote('http://172.40.1.1')).toBe(true);
  });
  test('baseUrlFor and modelFor', () => {
    const s = parseSettings({ provider: 'gemini', models: { gemini: 'gemini-x' } });
    expect(baseUrlFor(s, 'gemini')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(modelFor(s, 'gemini')).toBe('gemini-x');
    expect(modelFor(s, 'openai')).toBe('gpt-6-luna');
    expect(baseUrlFor(s, 'custom')).toBeNull();
  });
  test('insights and the own-key engine are off by default; stored junk falls back per field', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ insightDaily: false, insightWeekly: false, engine: 'rogo', dailyCeiling: 40 });
    const s = parseSettings({ engine: 'byok', provider: 'nope', dailyCeiling: 100000, insightDaily: 'yes', models: { openai: 5, gemini: 'ok' }, consents: { openai: { version: 1 } } });
    expect(s).toMatchObject({ engine: 'byok', provider: null, dailyCeiling: 200, insightDaily: false, models: { gemini: 'ok' }, consents: {} });
    expect(parseSettings('garbage')).toBe(DEFAULT_SETTINGS);
  });
  test('settings survive a restart and notify listeners', () => {
    const kv = memoryKv();
    const a = createSettingsStore(kv);
    let calls = 0;
    a.subscribe(() => (calls += 1));
    a.update({ insightDaily: true, dailyCeiling: 20 });
    expect(calls).toBe(1);
    expect(createSettingsStore(kv).get()).toMatchObject({ insightDaily: true, dailyCeiling: 20 });
  });
});
