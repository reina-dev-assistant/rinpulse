import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';

/**
 * Coach without a JoyoRogo account.
 *
 * The plan, the daily suggestion, the exercise library and the progress are all computed on the phone
 * (`plans/`, `suggest.ts`, `progress.ts`), so they need no account at all - they were only ever gated
 * behind one. This file also holds the settings for the chat, which upstream sends to JoyoRogo's own
 * LLM: with `localPlanEnabled` the chat can talk to any OpenAI-compatible endpoint instead, using a key
 * the wearer provides. Nothing here is synced anywhere.
 */

const KEY_ENABLED = 'joyofit.coach.local';
const KEY_BASE_URL = 'joyofit.coach.llm.baseUrl';
const KEY_MODEL = 'joyofit.coach.llm.model';
const KEY_TEMPERATURE = 'joyofit.coach.llm.temperature';
const KEY_MAX_TOKENS = 'joyofit.coach.llm.maxTokens';
/** The key is a credential: secure storage on both platforms, never the plain kv store. */
const KEY_API_KEY = 'joyofit.coach.llm.apiKey';

/** What an OpenAI-compatible provider needs. Ollama and LM Studio ignore the key but still accept the header. */
export interface LlmSettings {
  baseUrl: string;
  model: string;
  /** Empty means the provider does not need one (a local server). */
  apiKey: string;
  temperature: number;
  maxTokens: number;
}

/** Sensible defaults so the screen is usable without reading any documentation: a common provider and a cheap model. */
export const LLM_DEFAULTS: LlmSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  temperature: 0.4,
  maxTokens: 700,
};

/** Whether the plan side of Coach ignores the JoyoRogo account. Off by default: an untouched build behaves exactly as before. */
export function localCoachEnabled(): boolean {
  return Storage.getItemSync(KEY_ENABLED) === '1';
}

export function setLocalCoachEnabled(enabled: boolean): void {
  Storage.setItemSync(KEY_ENABLED, enabled ? '1' : '0');
}

function storedNumber(key: string, fallback: number, min: number, max: number): number {
  const raw = Storage.getItemSync(key);
  const value = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/** The non-secret half, synchronous so a screen can read it during render. */
export function llmSettings(): Omit<LlmSettings, 'apiKey'> {
  return {
    baseUrl: Storage.getItemSync(KEY_BASE_URL)?.trim() || LLM_DEFAULTS.baseUrl,
    model: Storage.getItemSync(KEY_MODEL)?.trim() || LLM_DEFAULTS.model,
    temperature: storedNumber(KEY_TEMPERATURE, LLM_DEFAULTS.temperature, 0, 2),
    maxTokens: Math.round(storedNumber(KEY_MAX_TOKENS, LLM_DEFAULTS.maxTokens, 64, 8192)),
  };
}

/** The key alone, from secure storage (async). Null when none was saved. */
export async function llmApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_API_KEY);
  } catch {
    return null;
  }
}

/** Everything the chat client needs, or null when no endpoint was configured yet. */
export async function llmConfig(): Promise<LlmSettings | null> {
  const settings = llmSettings();
  if (settings.baseUrl === '') return null;
  return { ...settings, apiKey: (await llmApiKey()) ?? '' };
}

export function saveLlmSettings(settings: Partial<LlmSettings>): void {
  if (settings.baseUrl !== undefined) Storage.setItemSync(KEY_BASE_URL, settings.baseUrl.trim());
  if (settings.model !== undefined) Storage.setItemSync(KEY_MODEL, settings.model.trim());
  if (settings.temperature !== undefined) Storage.setItemSync(KEY_TEMPERATURE, String(settings.temperature));
  if (settings.maxTokens !== undefined) Storage.setItemSync(KEY_MAX_TOKENS, String(settings.maxTokens));
}

/** Saving an empty key removes it, so "no key" and "an empty key" cannot drift apart. */
export async function saveLlmApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed === '') {
    await SecureStore.deleteItemAsync(KEY_API_KEY);
    return;
  }
  await SecureStore.setItemAsync(KEY_API_KEY, trimmed);
}

/**
 * Whether the chat can run: the local endpoint is on and an endpoint is set. The key is not required, so a
 * local server (Ollama, LM Studio) works; a provider that rejects the missing key returns its own error.
 */
export async function llmReady(): Promise<boolean> {
  if (!localCoachEnabled()) return false;
  return (await llmConfig()) !== null;
}

/** True when the chat should go to the wearer's own endpoint rather than JoyoRogo's. */
export function usesLocalLlm(): boolean {
  return localCoachEnabled();
}
