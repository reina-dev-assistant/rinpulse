import { describe, expect, it } from 'bun:test';

import { createSleepInsightsClient, type SleepNightPayload } from './sleepInsightsClient';

const night: SleepNightPayload = {
  wakeDate: '2026-10-19',
  onsetMs: 1,
  wakeMs: 2,
  tzOffsetMin: 420,
  asleepS: 1,
  awakeS: 0,
  awakenings: 0,
  hasStages: false,
  deepS: null,
  remS: null,
  lightS: null,
  watchScore: null,
  hrvMs: null,
  rhrBpm: null,
  naps: [],
};

class Http extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

function fake(result: unknown) {
  const calls: { path: string; input: unknown }[] = [];
  const call = (async (path: string, input: unknown) => {
    calls.push({ path, input });
    if (result instanceof Error) throw result;
    return result;
  }) as Parameters<typeof createSleepInsightsClient>[0];
  return { calls, client: createSleepInsightsClient(call) };
}

describe('sleep insights client', () => {
  it('reads the status from sleepInsights/status', async () => {
    const status = { enabled: true, consentVersion: 1, currentVersion: 1, nights: 3, latestWakeDate: null, freeDaysMask: 65 };
    const { calls, client } = fake(status);
    expect(await client.sleepInsightsStatus()).toEqual(status);
    expect(calls).toEqual([{ path: 'sleepInsights/status', input: {} }]);
  });

  it('answers null for status on an older JoyoRogo', async () => {
    expect(await fake(new Http(404, 'NOT_FOUND', 'x')).client.sleepInsightsStatus()).toBeNull();
    expect(await fake(new Http(405, null, 'x')).client.sleepInsightsStatus()).toBeNull();
  });

  it('lets other status errors through', async () => {
    await expect(fake(new Http(500, null, 'boom')).client.sleepInsightsStatus()).rejects.toThrow('boom');
  });

  it('sends the switch with its version', async () => {
    const { calls, client } = fake({});
    await client.setSleepInsightsConsent(true, 1);
    expect(calls).toEqual([{ path: 'sleepInsights/setConsent', input: { enabled: true, version: 1 } }]);
  });

  it('pushes nights and reports the saved count', async () => {
    const { calls, client } = fake({ saved: 1 });
    expect(await client.pushSleepNights([night])).toEqual({ kind: 'ok', saved: 1 });
    expect(calls).toEqual([{ path: 'sleepInsights/upsertNights', input: { nights: [night] } }]);
  });

  it('types consent_required and an unsupported server', async () => {
    expect(await fake(new Http(403, 'FORBIDDEN', 'consent_required')).client.pushSleepNights([night])).toEqual({ kind: 'consent_required' });
    expect(await fake(new Http(404, null, 'x')).client.pushSleepNights([night])).toEqual({ kind: 'unsupported' });
    await expect(fake(new Http(403, 'FORBIDDEN', 'other')).client.pushSleepNights([night])).rejects.toThrow('other');
  });
});
