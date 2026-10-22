import { describe, expect, test } from 'bun:test';

import { grantConsent } from './consent';
import { buildDigest } from './digest';
import { dailyFacts, insightFor, insightPrompt, insightSlot, RETRY_AFTER_SEC, validateInsight, weeklyFacts, createInsightStore, type InsightDeps } from './insight';
import { memoryKv, memorySecrets } from './kv';
import { createKeyVault } from './keyVault';
import { createSettingsStore } from './settings';
import { adult, fourteenDays, sampleSource, scriptedAdapter, textReply, TODAY } from './testFixtures';
import { createUsageStore } from './usage';
import { AiError } from './types';

const NOW = 1_792_000_000;

async function setup(over: { daily?: boolean; weekly?: boolean; age?: number | null; script?: Parameters<typeof scriptedAdapter>[0]; consent?: boolean } = {}) {
  const kv = memoryKv();
  const settings = createSettingsStore(kv);
  const vault = createKeyVault(memorySecrets());
  await vault.set('openai', 'sk-x-12345678');
  settings.update({ provider: 'openai', keySaved: { openai: true }, insightDaily: over.daily ?? true, insightWeekly: over.weekly ?? false });
  if (over.consent !== false) grantConsent(settings, 'openai', 'https://api.openai.com/v1', NOW);
  const adapter = scriptedAdapter(over.script ?? [textReply('Kesiapanmu Strained.')]);
  const store = createInsightStore(kv);
  const deps: InsightDeps = {
    settings,
    usage: createUsageStore(kv),
    store,
    getKey: vault.get,
    adapters: { openai: adapter, anthropic: adapter },
    person: { ...adult, ageYears: over.age === undefined ? 30 : over.age },
    digest: async () => buildDigest(sampleSource()),
    locale: 'id',
    nowSec: () => NOW,
    today: TODAY,
  };
  return { deps, adapter, settings, store };
}

describe('slots: insights are off until the person turns them on', () => {
  test('default settings give no slot; Monday prefers the weekly review', () => {
    expect(insightSlot({ insightDaily: false, insightWeekly: false }, '2026-10-26')).toBeNull();
    expect(insightSlot({ insightDaily: true, insightWeekly: false }, '2026-10-26')).toEqual({ kind: 'daily', key: '2026-10-26' });
    expect(insightSlot({ insightDaily: true, insightWeekly: true }, '2026-10-26')).toEqual({ kind: 'weekly', key: '2026-10-26' });
    expect(insightSlot({ insightDaily: true, insightWeekly: true }, '2026-10-27')).toEqual({ kind: 'daily', key: '2026-10-27' });
    expect(insightSlot({ insightDaily: false, insightWeekly: true }, '2026-10-27')).toBeNull();
  });
});

describe('facts', () => {
  test('daily facts carry only known values, never zero for missing', () => {
    const digest = buildDigest(sampleSource({ days: fourteenDays((i) => (i === 13 ? { sleepMin: null, restBpm: null } : {})) }));
    const facts = dailyFacts(digest);
    expect(facts.values.readiness).toBe('Strained');
    expect(facts.values).not.toHaveProperty('sleepLastNightHours');
    expect(facts.values).not.toHaveProperty('restingBpm');
    expect(facts.values.hrvBaselineMs).toBe(47);
  });
  test('weekly facts compare this week with the one before', () => {
    const digest = buildDigest(sampleSource({ days: fourteenDays((i) => (i < 7 ? { sleepMin: 360 } : { sleepMin: 420 })) }));
    const facts = weeklyFacts(digest);
    expect(facts.values).toMatchObject({ windowDays: 7, sleepAvgHours: 7, sleepAvgHoursPreviousWeek: 6 });
  });
});

describe('validator: a number that is not in the facts is refused', () => {
  const facts = dailyFacts(buildDigest(sampleSource()));
  test('accepts numbers from the facts in either decimal style', () => {
    expect(validateInsight('Tidurmu 7 jam, HRV 38 ms dari dasar 47 ms, rasio 1,12.', facts)).toMatchObject({ ok: true });
  });
  test('refuses invented or computed numbers', () => {
    expect(validateInsight('HRV turun 9 ms.', facts)).toEqual({ ok: false, reason: 'number' });
    expect(validateInsight('Tidurmu 8 jam.', facts)).toEqual({ ok: false, reason: 'number' });
  });
  test('refuses emoji, markdown, medical wording, empty and over-long text', () => {
    expect(validateInsight('Mantap sekali \u{1F4AA}', facts)).toEqual({ ok: false, reason: 'emoji' });
    expect(validateInsight('**Tebal** tanpa angka', facts)).toEqual({ ok: false, reason: 'markdown' });
    expect(validateInsight('- butir satu', facts)).toEqual({ ok: false, reason: 'markdown' });
    expect(validateInsight('Ada nyeri dada hari ini', facts)).toEqual({ ok: false, reason: 'medical' });
    expect(validateInsight('   ', facts)).toEqual({ ok: false, reason: 'empty' });
    expect(validateInsight('kata '.repeat(200), facts)).toEqual({ ok: false, reason: 'long' });
  });
  test('the prompt tells the model to use only the facts and to stay descriptive when cautious', () => {
    const p = insightPrompt(facts, 'id', true);
    expect(p.system).toContain('ONLY numbers that appear in FACTS');
    expect(p.system).toContain('Be conservative');
    expect(p.user).toContain('"readiness":"Strained"');
    expect(insightPrompt(facts, 'en', false, true).system).toContain('previous text broke a rule');
  });
});

describe('generation', () => {
  const slot = { kind: 'daily' as const, key: TODAY };

  test('writes, validates and caches one text per slot; the second ask costs nothing', async () => {
    const t = await setup({ script: [textReply('Kesiapanmu Strained, HRV 38 ms dari dasar 47 ms.')] });
    expect(await insightFor(slot, t.deps)).toBe('Kesiapanmu Strained, HRV 38 ms dari dasar 47 ms.');
    expect(await insightFor(slot, t.deps)).toBe('Kesiapanmu Strained, HRV 38 ms dari dasar 47 ms.');
    expect(t.adapter.requests).toHaveLength(1);
    expect(t.adapter.requests[0]!.tools).toBeUndefined();
    expect(t.deps.usage.today(NOW).calls).toBe(1);
  });

  test('a text that breaks a rule gets one stricter retry; two failures show nothing and start a cool-down', async () => {
    const t = await setup({ script: [textReply('HRV turun 9 ms'), textReply('HRV turun 11 ms')] });
    expect(await insightFor(slot, t.deps)).toBeNull();
    expect(t.adapter.requests).toHaveLength(2);
    expect(t.adapter.requests[1]!.system).toContain('previous text broke a rule');
    expect(t.store.waiting(NOW)).toBe(true);
    expect(await insightFor(slot, t.deps)).toBeNull();
    expect(t.adapter.requests).toHaveLength(2);
    expect(t.store.waiting(NOW + RETRY_AFTER_SEC + 1)).toBe(false);
  });

  test('a provider error shows nothing (the rules text stays) and starts the cool-down', async () => {
    const t = await setup({ script: [new AiError('quota', 429, 'x')] });
    expect(await insightFor(slot, t.deps)).toBeNull();
    expect(t.store.waiting(NOW)).toBe(true);
  });

  test('no consent, under 18 or the ceiling reached: nothing is generated or sent', async () => {
    const noConsent = await setup({ consent: false });
    expect(await insightFor(slot, noConsent.deps)).toBeNull();
    expect(noConsent.adapter.requests).toHaveLength(0);
    const minor = await setup({ age: 15 });
    expect(await insightFor(slot, minor.deps)).toBeNull();
    expect(minor.adapter.requests).toHaveLength(0);
    const capped = await setup();
    capped.settings.update({ dailyCeiling: 5 });
    for (let i = 0; i < 5; i++) capped.deps.usage.record(NOW, null);
    expect(await insightFor(slot, capped.deps)).toBeNull();
    expect(capped.adapter.requests).toHaveLength(0);
  });

  test('regenerating (force) replaces the cached text', async () => {
    const t = await setup({ script: [textReply('Kesiapanmu Strained.'), textReply('Kesiapanmu Strained hari ini.')] });
    await insightFor(slot, t.deps);
    expect(await insightFor(slot, t.deps, { force: true })).toBe('Kesiapanmu Strained hari ini.');
    expect(t.store.get('daily', TODAY, 'id')?.text).toBe('Kesiapanmu Strained hari ini.');
  });

  test('a cached text is per language', async () => {
    const t = await setup();
    await insightFor(slot, t.deps);
    expect(t.store.get('daily', TODAY, 'en')).toBeNull();
  });
});
