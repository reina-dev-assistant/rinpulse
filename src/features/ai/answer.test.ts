import { describe, expect, test } from 'bun:test';

import { answer, ANSWER_LIMITS, type AnswerDeps } from './answer';
import { grantConsent } from './consent';
import { memoryKv, memorySecrets } from './kv';
import { createKeyVault } from './keyVault';
import { adult, fakeToolData, sampleSource, scriptedAdapter, textReply, toolReply } from './testFixtures';
import { createSettingsStore, toolKey } from './settings';
import { createUsageStore } from './usage';
import { AiError } from './types';
import type { SafetyText } from './safety';
import idAi from '@/i18n/locales/id/ai.json';

const TEXT: SafetyText = { disclaimer: idAi.disclaimerLine, refuseLeak: idAi.refuseLeak, safe: idAi.safe };
const NOW = 1_792_000_000;

async function setup(opts: { consent?: boolean; key?: boolean; age?: number | null; script?: Parameters<typeof scriptedAdapter>[0]; ceiling?: number } = {}) {
  const kv = memoryKv();
  const settings = createSettingsStore(kv);
  const vault = createKeyVault(memorySecrets());
  settings.update({ provider: 'openai', engine: 'byok', dailyCeiling: opts.ceiling ?? 40, ...(opts.key === false ? {} : { keySaved: { openai: true } }) });
  if (opts.key !== false) await vault.set('openai', 'sk-live-ABCDEFGH12345678');
  if (opts.consent !== false) grantConsent(settings, 'openai', 'https://api.openai.com/v1', NOW);
  const adapter = scriptedAdapter(opts.script ?? [textReply('Tidurmu cukup.')]);
  const usage = createUsageStore(kv);
  const data = fakeToolData();
  let sourceCalls = 0;
  const deps: AnswerDeps = {
    settings,
    usage,
    getKey: vault.get,
    adapters: { openai: adapter, anthropic: adapter },
    person: { ...adult, ageYears: opts.age === undefined ? 30 : opts.age },
    source: async () => {
      sourceCalls += 1;
      return sampleSource();
    },
    data,
    text: TEXT,
    locale: 'id',
    nowSec: () => NOW,
  };
  return { deps, adapter, settings, usage, data, sourceCalls: () => sourceCalls };
}

const ask = (text: string) => [{ role: 'user' as const, content: text }];

describe('consent and age gating: nothing is sent unless it is allowed', () => {
  test('no consent: blocked before the digest is built or any provider call', async () => {
    const t = await setup({ consent: false });
    await expect(answer(ask('latihan apa hari ini?'), t.deps)).rejects.toMatchObject({ kind: 'blocked', detail: 'noConsent' });
    expect(t.adapter.requests).toHaveLength(0);
    expect(t.sourceCalls()).toBe(0);
  });
  test('no key saved or an empty vault: blocked', async () => {
    const t = await setup({ key: false });
    await expect(answer(ask('hai'), t.deps)).rejects.toMatchObject({ kind: 'blocked', detail: 'noKey' });
    const gone = await setup();
    await expect(answer(ask('hai'), { ...gone.deps, getKey: async () => null })).rejects.toMatchObject({ kind: 'blocked', detail: 'noKey' });
    expect(gone.adapter.requests).toHaveLength(0);
  });
  test('under 18: blocked, even for a worrying message that would get a fixed answer', async () => {
    const t = await setup({ age: 16 });
    await expect(answer(ask('latihan apa hari ini?'), t.deps)).rejects.toMatchObject({ kind: 'blocked', detail: 'minor' });
    await expect(answer(ask('nyeri dada'), t.deps)).rejects.toMatchObject({ kind: 'blocked', detail: 'minor' });
    expect(t.adapter.requests).toHaveLength(0);
  });
  test('unknown age is allowed and the prompt carries the unknown-age block', async () => {
    const t = await setup({ age: null });
    await answer(ask('latihan apa hari ini?'), t.deps);
    expect(t.adapter.requests[0]!.system).toContain('age is unknown');
  });
});

describe('safety pass before the provider', () => {
  test('a worrying last message gets the fixed answer with no provider call and no tokens spent', async () => {
    const t = await setup();
    const out = await answer(ask('tadi hampir pingsan waktu lari'), t.deps);
    expect(out.fixed).toBe(true);
    expect(out.flagged).toBe('medical');
    expect(out.reply).toEndWith(idAi.disclaimerLine);
    expect(t.adapter.requests).toHaveLength(0);
    expect(t.usage.today(NOW).calls).toBe(0);
  });
});

describe('answer loop', () => {
  test('a plain answer: digest in the system prompt, one call, usage counted, reply cleaned', async () => {
    const t = await setup({ script: [textReply('**Tidurmu** cukup, sekitar 7 jam.')] });
    const out = await answer(ask('Gimana tidurku?'), t.deps);
    expect(out.reply).toBe('Tidurmu cukup, sekitar 7 jam.');
    expect(out.trace).toEqual([]);
    expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 80, calls: 1 });
    expect(t.usage.today(NOW)).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 80 });
    const request = t.adapter.requests[0]!;
    expect(request.system).toContain('"v":1');
    expect(request.system).toContain('Lutut kiri sering nyeri');
    expect(request.tools?.length).toBe(8);
    expect(request.maxTokens).toBe(ANSWER_LIMITS.maxTokens);
    expect(t.adapter.conns[0]).toMatchObject({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna' });
  });

  test('a tool round trip: the call runs on the phone, its result goes back, the trace is kept', async () => {
    const t = await setup({ script: [toolReply({ id: 'c1', name: 'get_trend', args: { metric: 'hrvMs', days: 14 } }), textReply('HRV-mu turun 10 ms dibanding dua minggu sebelumnya.')] });
    const statuses: string[] = [];
    const out = await answer(ask('Kenapa HRV-ku turun?'), { ...t.deps, onEvent: (e) => statuses.push(e.type === 'toolDone' ? `${e.type}:${e.trace.tool}:${e.summary.count}` : e.type) });
    expect(out.reply).toContain('HRV-mu turun');
    expect(out.trace).toEqual([{ tool: 'get_trend', args: { metric: 'hrvMs', days: 14 } }]);
    expect(statuses).toEqual(['round', 'toolStart', 'toolDone:get_trend:14', 'round']);
    expect(out.steps).toEqual([{ id: 'c1', trace: out.trace[0], summary: { count: 14, empty: false, failed: false, notConnected: false } }]);
    const second = t.adapter.requests[1]!.messages;
    expect(second.at(-2)).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'c1', name: 'get_trend' }] });
    expect(second.at(-1)).toMatchObject({ role: 'tool', callId: 'c1' });
    expect(JSON.parse((second.at(-1) as { content: string }).content)).toMatchObject({ metric: 'hrvMs', mean: 40 });
    expect(out.usage.calls).toBe(2);
  });

  test('tool rounds are limited: after 6 the model is asked to answer without tools', async () => {
    const loop = Array.from({ length: ANSWER_LIMITS.toolRounds }, (_, i) => toolReply({ id: `c${i}`, name: 'get_plan', args: {} }));
    const t = await setup({ script: [...loop, textReply('Cukup, ini jawabanku.')] });
    const out = await answer(ask('lihat semuanya'), t.deps);
    expect(out.reply).toBe('Cukup, ini jawabanku.');
    expect(out.trace).toHaveLength(ANSWER_LIMITS.toolRounds);
    expect(t.adapter.requests).toHaveLength(ANSWER_LIMITS.toolRounds + 1);
    expect(t.adapter.requests.at(-1)!.tools).toBeUndefined();
  });

  test('at most 4 tool calls run per round', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: 'get_plan', args: {} }));
    const t = await setup({ script: [toolReply(...many), textReply('ok')] });
    const out = await answer(ask('banyak'), t.deps);
    expect(out.trace).toHaveLength(ANSWER_LIMITS.toolCallsPerRound);
  });

  test('a hostile tool result or note cannot cause an action: the only write-like tool is propose_note and it stores nothing', async () => {
    const t = await setup({ script: [toolReply({ id: 'c1', name: 'propose_note', args: { text: 'Cedera lutut kanan' } }), textReply('Aku sarankan catatan itu.')] });
    const out = await answer(ask('tolong ingat lututku'), t.deps);
    expect(out.proposedNotes).toEqual(['Cedera lutut kanan']);
    expect(t.data.calls).toEqual([]);
  });

  test('a model without tool calling: the first call falls back to the digest alone and the model is remembered', async () => {
    const t = await setup({ script: [new AiError('noTools', 400, 'no tools'), textReply('Dari data saja: tidurmu cukup.')] });
    const out = await answer(ask('tidur?'), t.deps);
    expect(out.toolsUnsupported).toBe(true);
    expect(t.adapter.requests[0]!.tools).toBeDefined();
    expect(t.adapter.requests[1]!.tools).toBeUndefined();
    expect(t.adapter.requests[1]!.system).not.toContain('propose_note');
    expect(t.settings.get().noTools).toContain(toolKey('openai', 'gpt-6-luna'));
    // next question goes straight to digest-only
    const again = await setup({ script: [textReply('ok')] });
    again.settings.update({ noTools: [toolKey('openai', 'gpt-6-luna')] });
    await answer(ask('tidur?'), again.deps);
    expect(again.adapter.requests[0]!.tools).toBeUndefined();
  });

  test('provider errors reach the caller as AiError and an answer-less reply is an empty error', async () => {
    const bad = await setup({ script: [new AiError('badKey', 401, 'x')] });
    await expect(answer(ask('hai'), bad.deps)).rejects.toMatchObject({ kind: 'badKey' });
    const empty = await setup({ script: [textReply('   ')] });
    await expect(answer(ask('hai'), empty.deps)).rejects.toMatchObject({ kind: 'empty' });
  });

  test('the daily ceiling stops the loop and the next question', async () => {
    const t = await setup({ ceiling: 5, script: [toolReply({ id: 'c1', name: 'get_plan', args: {} }), textReply('ok')] });
    for (let i = 0; i < 4; i++) t.usage.record(NOW, null);
    await expect(answer(ask('hai'), t.deps)).rejects.toMatchObject({ kind: 'blocked', detail: 'ceiling' });
    const full = await setup({ ceiling: 5 });
    for (let i = 0; i < 5; i++) full.usage.record(NOW, null);
    await expect(answer(ask('hai'), full.deps)).rejects.toMatchObject({ kind: 'blocked', detail: 'ceiling' });
    expect(full.adapter.requests).toHaveLength(0);
  });

  test('the conversation is cut to the last 12 turns and each turn to 2,000 characters', async () => {
    const t = await setup();
    const long = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `${i} ${'x'.repeat(3000)}` }));
    await answer([...long, { role: 'user', content: 'terakhir' }], t.deps);
    const sent = t.adapter.requests[0]!.messages;
    expect(sent.length).toBeLessThanOrEqual(ANSWER_LIMITS.turns);
    for (const m of sent) if (m.role !== 'tool') expect(m.content.length).toBeLessThanOrEqual(2000);
    // the cut never starts with an answer (Anthropic needs the first message from the user)
    expect(sent[0]!.role).toBe('user');
  });

  test('the key goes only to the adapter connection, never into the prompt or the messages', async () => {
    const t = await setup();
    await answer(ask('hai'), t.deps);
    expect(JSON.stringify(t.adapter.requests)).not.toContain('sk-live');
    expect(t.adapter.conns[0]!.apiKey).toBe('sk-live-ABCDEFGH12345678');
  });

  test('events: a round starts, text and reasoning arrive, tools start and end; the final reply is authoritative', async () => {
    const t = await setup({ script: [toolReply({ id: 'c1', name: 'get_plan', args: {} }), textReply('**Rencanamu** minggu ke-4.')] });
    const events: string[] = [];
    const out = await answer(ask('plan?'), { ...t.deps, onEvent: (e) => events.push(e.type) });
    expect(events).toEqual(['round', 'toolStart', 'toolDone', 'round']);
    expect(out.reply).toBe('Rencanamu minggu ke-4.');
    expect(out.reasoning).toBe('');
  });

  test('a thinking model that ran out of budget gets one more try with more room, counted as a call', async () => {
    const t = await setup({ script: [new AiError('truncated', 200, 'finish_reason=length'), textReply('Ini jawabannya.')] });
    const out = await answer(ask('review minggu ini'), t.deps);
    expect(out.reply).toBe('Ini jawabannya.');
    expect(t.adapter.requests.map((r) => r.maxTokens)).toEqual([ANSWER_LIMITS.maxTokens, ANSWER_LIMITS.maxTokensRetry]);
    expect(t.usage.today(NOW).calls).toBe(2);
  });

  test('truncated twice is an error that carries the technical line', async () => {
    const t = await setup({ script: [new AiError('truncated', 200, 'finish_reason=length; answer=0 chars'), new AiError('truncated', 200, 'finish_reason=length; answer=0 chars')] });
    await expect(answer(ask('review'), t.deps)).rejects.toMatchObject({ kind: 'truncated', detail: 'finish_reason=length; answer=0 chars' });
  });

  test('the reasoning of the answer is kept apart from the reply', async () => {
    const t = await setup({ script: [{ ...textReply('Tidurmu cukup.'), thinking: 'Lihat data tidur dulu.' }] });
    const out = await answer(ask('tidur?'), t.deps);
    expect(out.reply).toBe('Tidurmu cukup.');
    expect(out.reasoning).toBe('Lihat data tidur dulu.');
  });

  test('a reply that is only markup is an empty error with the stop word', async () => {
    const t = await setup({ script: [textReply('<think>hmm</think>')] });
    await expect(answer(ask('tidur?'), t.deps)).rejects.toMatchObject({ kind: 'empty' });
  });
});

describe('history sent to the model', () => {
  test('older answers are cut, the last two turns are whole', async () => {
    const t = await setup();
    const long = 'x'.repeat(1500);
    await answer(
      [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: long },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: long },
        { role: 'user', content: 'q3' },
      ],
      t.deps,
    );
    const sent = t.adapter.requests[0]!.messages.map((m) => (m.role === 'assistant' ? m.content.length : 0));
    expect(sent[1]).toBe(ANSWER_LIMITS.oldAnswerChars + 3);
    expect(sent[3]).toBe(1500);
  });
});
