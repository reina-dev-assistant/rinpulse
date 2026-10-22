import type { SQLiteDatabase } from 'expo-sqlite';

import { getLocale } from '@/i18n';
import type { CoachState } from '@/features/coach/useCoach';
import { ADAPTERS } from './adapters';
import { startTiming } from './timing';
import { baseUrlFor, byokAccess, modelFor, type ByokAccess } from './access';
import { answer, type Answer, type AnswerDeps } from './answer';
import { grantConsent } from './consent';
import { addDays } from '@/features/coach/time';
import { createToolData, gatherDigestSource } from './data/assemble';
import { createRogoData } from './data/rogoData';
import { readPerson } from './data/personData';
import { buildDigest, digestJson, type Digest } from './digest';
import { insightFor, insightSlot, type InsightKind } from './insight';
import { resolveModel } from './models';
import { normalizeBaseUrl, PROVIDERS } from './providers';
import type { ChatLine, SafetyText } from './safety';
import { aiInsights, aiKv, aiNotes, aiSettings, aiUsage, aiVault } from './stores';
import { AiError, type ModelInfo, type ProviderId } from './types';

const nowSec = (): number => Math.floor(Date.now() / 1000);

const locale = (): 'id' | 'en' => (getLocale() === 'en' ? 'en' : 'id');

/** The gate for the stored settings right now (age from the phone and the JoyoRogo profile). */
export async function currentAccess(signedIn: boolean): Promise<{ access: ByokAccess; ageYears: number | null }> {
  const person = await readPerson(aiKv, signedIn);
  return { access: byokAccess(aiSettings.get(), person.ageYears), ageYears: person.ageYears };
}

export interface AskInput {
  db: SQLiteDatabase;
  coach: CoachState;
  signedIn: boolean;
  history: readonly ChatLine[];
  text: SafetyText;
  signal?: AbortSignal;
  onEvent?: AnswerDeps['onEvent'];
}

/** One answer with the person's own key, with everything bound to the phone's stores. */
export async function askJoyoAi(input: AskInput): Promise<Answer> {
  const mark = startTiming('ask');
  mark('person-read');
  const person = await readPerson(aiKv, input.signedIn);
  mark('person-done');
  const tools = createToolData(input.db, input.coach);
  return answer(input.history, {
    settings: aiSettings,
    usage: aiUsage,
    getKey: aiVault.get,
    person,
    source: () => gatherDigestSource({ db: input.db, coach: input.coach, person, notes: aiNotes.list(), signedIn: input.signedIn, locale: locale(), tools, mark }),
    data: tools,
    text: input.text,
    locale: locale(),
    nowSec,
    signal: input.signal,
    onEvent: input.onEvent,
    mark,
  });
}

/**
 * Reads the JoyoRogo diary and weight for the digest ahead of the first question (when the chat opens), into the session cache, so the
 * question itself does not wait for the network. Failures are ignored: the question reads them again.
 */
export function warmDigestData(today: string, signedIn: boolean): void {
  if (!signedIn) return;
  const rogoData = createRogoData();
  const from = addDays(today, -13);
  void Promise.all([rogoData.food(from, today), rogoData.weights(from, today)]).catch(() => {});
}

/** The digest as it would be sent now, for "Lihat data yang dikirim" and the consent screen's sample. */
export async function previewDigest(db: SQLiteDatabase, coach: CoachState, signedIn: boolean): Promise<{ digest: Digest; json: string }> {
  const person = await readPerson(aiKv, signedIn);
  const tools = createToolData(db, coach);
  const digest = buildDigest(await gatherDigestSource({ db, coach, person, notes: aiNotes.list(), signedIn, locale: locale(), tools }));
  return { digest, json: digestJson(digest) };
}

/** The insight for today's slot (null when off, blocked, cooling down or invalid). Cached per day or Monday. */
export async function todaysInsight(input: { db: SQLiteDatabase; coach: CoachState; signedIn: boolean; force?: boolean; signal?: AbortSignal }): Promise<{ kind: InsightKind; text: string } | null> {
  const slot = insightSlot(aiSettings.get(), input.coach.today);
  if (!slot) return null;
  const person = await readPerson(aiKv, input.signedIn);
  const tools = createToolData(input.db, input.coach);
  const text = await insightFor(
    slot,
    {
      settings: aiSettings,
      usage: aiUsage,
      store: aiInsights,
      getKey: aiVault.get,
      person,
      digest: async () => buildDigest(await gatherDigestSource({ db: input.db, coach: input.coach, person, notes: aiNotes.list(), signedIn: input.signedIn, locale: locale(), tools })),
      locale: locale(),
      nowSec,
      today: input.coach.today,
      signal: input.signal,
    },
    { force: input.force },
  );
  return text === null ? null : { kind: slot.kind, text };
}

// ---- setup ----

export interface TestInput {
  provider: ProviderId;
  /** For `custom`: the endpoint the person typed. */
  baseUrl: string;
  apiKey: string;
  /** The model the person picked, or null to use the default / first listed. */
  model: string | null;
  signal?: AbortSignal;
}

export type TestResult =
  | { ok: true; model: string; models: ModelInfo[]; calls: number; tokens: number }
  | { ok: false; error: AiError };

/**
 * The key test: lists the provider's models, picks the model (the list decides, so a retired default never blocks), and sends ONE tiny
 * message ("reply OK"). No health data is sent. The key goes only to the provider's own host.
 */
export async function testProvider(input: TestInput): Promise<TestResult> {
  const preset = PROVIDERS[input.provider];
  const baseUrl = preset.customUrl ? normalizeBaseUrl(input.baseUrl) : preset.baseUrl;
  if (!baseUrl) return { ok: false, error: new AiError('badRequest', null, 'url') };
  const adapter = ADAPTERS[preset.adapter];
  const opts = { signal: input.signal };
  let calls = 0;
  let models: ModelInfo[] = [];
  try {
    calls += 1;
    models = await adapter.listModels({ baseUrl, apiKey: input.apiKey }, opts);
  } catch (error) {
    // A server without a model list (some custom gateways) still may answer chat; a refused key or no network is final.
    if (error instanceof AiError && ['badKey', 'forbidden', 'quota', 'network', 'timeout', 'aborted'].includes(error.kind)) return { ok: false, error };
    if (!(error instanceof AiError)) throw error;
  }
  const model = resolveModel(input.provider, input.model, models);
  if (!model) return { ok: false, error: new AiError('modelNotFound', null, 'no model') };
  try {
    calls += 1;
    const reply = await adapter.complete({ baseUrl, apiKey: input.apiKey, model }, { model, system: 'You are a connection test. Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 16 }, opts);
    return { ok: true, model, models, calls, tokens: (reply.usage?.inputTokens ?? 0) + (reply.usage?.outputTokens ?? 0) };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, error };
    throw error;
  }
}

/**
 * Saves a tested provider: the key into the secure store, the choice into the settings, and the person's explicit consent for this
 * provider and endpoint. The own-key chat becomes the engine in use. Call only after the person ticked the consent and the test passed.
 */
export async function connectProvider(input: { provider: ProviderId; baseUrl: string; apiKey: string; model: string }): Promise<void> {
  const preset = PROVIDERS[input.provider];
  const baseUrl = preset.customUrl ? (normalizeBaseUrl(input.baseUrl) ?? '') : preset.baseUrl;
  await aiVault.set(input.provider, input.apiKey);
  aiSettings.update((s) => ({
    engine: 'byok',
    provider: input.provider,
    models: { ...s.models, [input.provider]: input.model },
    customBaseUrl: preset.customUrl ? baseUrl : s.customBaseUrl,
    keySaved: { ...s.keySaved, [input.provider]: true as const },
  }));
  grantConsent(aiSettings, input.provider, baseUrl, nowSec());
}

/** Changes only the model of the provider in use (the key stays). */
export function chooseModel(provider: ProviderId, model: string): void {
  aiSettings.update((s) => ({ models: { ...s.models, [provider]: model } }));
}

/** The provider list for the model picker, with the key from the secure store. Null when no key is saved. */
export async function listProviderModels(provider: ProviderId): Promise<ModelInfo[] | null> {
  const settings = aiSettings.get();
  const key = await aiVault.get(provider);
  const baseUrl = baseUrlFor(settings, provider);
  if (!key || !baseUrl) return null;
  return ADAPTERS[PROVIDERS[provider].adapter].listModels({ baseUrl, apiKey: key });
}

export { modelFor };
