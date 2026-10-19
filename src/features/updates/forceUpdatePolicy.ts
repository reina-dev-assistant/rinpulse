/**
 * Pure rules of the launch-time update gate (docs/force-update.md), free of React Native imports so `bun test` can
 * run them. `useUpdateGate` feeds these the server config (`GET /v1/app-config`), the native build and the clock.
 */

export type GatePlatform = 'android' | 'ios';

export interface PlatformGate {
  /** Native builds below this are blocked. 0 = gate off. */
  minBuild: number;
  /** Native builds below this (and at or above `minBuild`) get a dismissible banner. */
  latestBuild: number;
  storeUrl: string;
}

export interface GateConfig {
  android: PlatformGate;
  ios: PlatformGate;
  /** Owner text for the blocking screen; null = the app's own copy. */
  message: string | null;
}

export type GateDecision =
  | { kind: 'none' }
  | { kind: 'banner'; storeUrl: string }
  | { kind: 'block'; storeUrl: string; message: string | null };

/** A config younger than this is used without asking the server again; also the cache that survives a failed re-check. */
export const CONFIG_TTL_MS = 5 * 60 * 1000;

/** Upper bound the cold-start gate waits for the server before letting the app open. */
export const GATE_FETCH_TIMEOUT_MS = 4000;

/** Longest the cold start waits for a newer JS bundle before the app opens anyway. */
export const OTA_LAUNCH_TIMEOUT_MS = 8000;

/** A launch that follows our own OTA reload within this window does not reload again (no loop on a flapping server). */
export const OTA_RELOAD_GUARD_MS = 60 * 1000;

const PLATFORMS: readonly GatePlatform[] = ['android', 'ios'];

function build(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 0;
}

function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return /^https:\/\/[^\s]+$/.test(value) ? value : null;
}

/**
 * Validates the server answer. Null when it is not usable at all (the gate then stays off); a platform with a bad
 * block counts as off for that platform rather than rejecting the rest.
 */
export function parseGateConfig(raw: unknown): GateConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const out: Partial<Record<GatePlatform, PlatformGate>> = {};
  for (const platform of PLATFORMS) {
    const entry = record[platform];
    const e = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const storeUrl = httpsUrl(e.storeUrl);
    const minBuild = storeUrl === null ? 0 : build(e.minBuild);
    out[platform] = { minBuild, latestBuild: Math.max(minBuild, build(e.latestBuild)), storeUrl: storeUrl ?? '' };
  }
  const message = typeof record.message === 'string' && record.message.trim() ? record.message.trim().slice(0, 500) : null;
  return { android: out.android as PlatformGate, ios: out.ios as PlatformGate, message };
}

/**
 * Config x native build x platform to what the app does. Fails open on everything unknown: no config, a platform
 * the gate does not cover (web), a build number that could not be read (0), `minBuild` 0 (the default).
 */
export function decideGate(config: GateConfig | null, nativeBuild: number, platform: string): GateDecision {
  if (config === null || nativeBuild <= 0) return { kind: 'none' };
  if (platform !== 'android' && platform !== 'ios') return { kind: 'none' };
  const gate = config[platform];
  if (gate.storeUrl === '') return { kind: 'none' };
  if (gate.minBuild > 0 && nativeBuild < gate.minBuild) {
    return { kind: 'block', storeUrl: gate.storeUrl, message: config.message };
  }
  if (gate.latestBuild > 0 && nativeBuild < gate.latestBuild) return { kind: 'banner', storeUrl: gate.storeUrl };
  return { kind: 'none' };
}

export interface CachedGateConfig {
  fetchedAt: number;
  config: GateConfig;
}

/** Parses the persisted cache; anything damaged counts as no cache. */
export function parseCachedConfig(raw: string | null | undefined): CachedGateConfig | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { fetchedAt?: unknown; config?: unknown };
    const config = parseGateConfig(value.config);
    if (config === null || typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt)) return null;
    return { fetchedAt: value.fetchedAt, config };
  } catch {
    return null;
  }
}

/** Fresh = younger than the TTL. A timestamp in the future (clock moved back) is not trusted. */
export function isCacheFresh(cached: CachedGateConfig | null, now: number): boolean {
  if (cached === null) return false;
  if (cached.fetchedAt > now) return false;
  return now - cached.fetchedAt < CONFIG_TTL_MS;
}

/** True when the server must be asked: nothing fresh cached, or the person pressed "Cek lagi". */
export function needsFetch(cached: CachedGateConfig | null, now: number, force: boolean): boolean {
  return force || !isCacheFresh(cached, now);
}

/**
 * The config the decision uses. A successful fetch wins; when the fetch failed or was skipped, a fresh cache is
 * used; anything else is null, which never blocks.
 */
export function resolveGateConfig(args: { cached: CachedGateConfig | null; fetched: GateConfig | null; now: number }): GateConfig | null {
  if (args.fetched !== null) return args.fetched;
  return isCacheFresh(args.cached, args.now) ? (args.cached as CachedGateConfig).config : null;
}

/** Resume re-checks of the gate, at most every CONFIG_TTL_MS (the cache TTL); a clock moved backwards does not lock it out. */
export function shouldRecheckGate(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null || lastCheckedAt > now) return true;
  return now - lastCheckedAt >= CONFIG_TTL_MS;
}

/** The cold-start OTA refresh runs unless this launch is the reload we just did ourselves. */
export function shouldRefreshOtaAtLaunch(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null || lastReloadAt > now) return true;
  return now - lastReloadAt >= OTA_RELOAD_GUARD_MS;
}

export type StoreKind = 'play' | 'testflight' | 'appstore' | 'web';

export interface StoreTargets {
  kind: StoreKind;
  /** Tried in order until one opens. */
  primary: string[];
  /** A second page worth offering (Play: the testing opt-in page), or null. */
  secondary: string | null;
}

const TESTFLIGHT_JOIN = /^https:\/\/testflight\.apple\.com\/join\/([A-Za-z0-9_-]+)\/?$/;

/**
 * Where "Perbarui" goes. Android: the Play app page (`market://`, so the Play app opens directly) with the https
 * page as fallback; when the server's URL is the closed-testing opt-in page it is offered as a second link for
 * testers who have to opt in. iOS: TestFlight (`itms-beta://`) when the URL is a public join link, else the URL.
 */
export function storeTargets(platform: string, storeUrl: string, androidPackage: string): StoreTargets {
  if (platform === 'android') {
    const testing = storeUrl.includes('/apps/testing/');
    return {
      kind: 'play',
      primary: [`market://details?id=${androidPackage}`, ...(testing ? [] : [storeUrl])],
      secondary: testing ? storeUrl : null,
    };
  }
  const join = TESTFLIGHT_JOIN.exec(storeUrl);
  if (join) return { kind: 'testflight', primary: [`itms-beta://testflight.apple.com/join/${join[1]}`, storeUrl], secondary: null };
  return { kind: storeUrl.includes('apps.apple.com') ? 'appstore' : 'web', primary: [storeUrl], secondary: null };
}
