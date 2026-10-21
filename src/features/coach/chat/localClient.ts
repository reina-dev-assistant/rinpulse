import { llmConfig, type LlmSettings } from '../localSettings';
import type { ChatAnswer, ChatTurn } from './api';
import { localMessages } from './localPrompt';
import type { CoachSnapshot } from './snapshot';

/**
 * The chat against any OpenAI-compatible endpoint (`POST <baseUrl>/chat/completions`) instead of JoyoRogo's server.
 *
 * OpenAI, OpenRouter, Groq, DeepSeek, Together, Ollama and LM Studio all speak this shape, so one client covers
 * the whole list. Two things upstream's server did are gone by design and must not be pretended: there is no
 * daily cap (the wearer pays their own provider), and there is no keyword screen for injuries - that lives in
 * the system prompt as an instruction, and the UI says so.
 */

/** No endpoint configured: the screen shows the settings hint instead of an error. */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super('No LLM endpoint is configured');
    this.name = 'LlmNotConfiguredError';
  }
}

/** The endpoint answered with an error, or was not reachable. */
export class LlmError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

const TIMEOUT_MS = 60_000;

/** `<baseUrl>/chat/completions`, tolerating a trailing slash and a base URL that already ends in `/v1`. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
}

interface CompletionChoice {
  message?: { content?: unknown };
}

/** Pulls the reply text out, or the provider's own error message when the shape is not what we expect. */
function readAnswer(json: unknown): string {
  const choices = (json as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new LlmError(200, 'the endpoint returned no answer');
  const content = (choices[0] as CompletionChoice | undefined)?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') throw new LlmError(200, 'the endpoint returned an empty answer');
  return content.trim();
}

/** The provider's error text, falling back to the status. Providers differ: `error.message`, `message`, or plain text. */
function readError(status: number, body: unknown, raw: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  const fromError = (error as { message?: unknown } | null)?.message;
  if (typeof fromError === 'string' && fromError !== '') return fromError;
  const fromMessage = (body as { message?: unknown } | null)?.message;
  if (typeof fromMessage === 'string' && fromMessage !== '') return fromMessage;
  const text = raw.trim();
  if (text !== '') return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  return `the endpoint answered ${status}`;
}

/**
 * One turn. [settings] is passed in so the caller can come from the settings screen or from a test; it loads
 * the stored one when omitted.
 */
export async function localChat(
  turns: readonly ChatTurn[],
  snapshot: CoachSnapshot,
  settings?: LlmSettings,
): Promise<ChatAnswer> {
  const config = settings ?? (await llmConfig());
  if (config === null) throw new LlmNotConfiguredError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  let raw = '';
  try {
    response = await fetch(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Ollama and LM Studio ignore it; a hosted provider refuses the request without it.
        ...(config.apiKey === '' ? {} : { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        model: config.model,
        messages: localMessages(snapshot, turns),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
      signal: controller.signal,
    });
    raw = await response.text();
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new LlmError(0, `the endpoint did not answer within ${TIMEOUT_MS / 1000} s`);
    throw new LlmError(0, e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = raw === '' ? null : JSON.parse(raw);
  } catch {
    body = null;
  }

  if (!response.ok) throw new LlmError(response.status, readError(response.status, body, raw));
  // `used`/`cap` are the JoyoRogo server's own accounting; with a personal endpoint there is none, and the
  // screen hides the counter on `cap <= 0` rather than showing a made-up limit.
  return { reply: readAnswer(body), used: 0, cap: 0, flagged: null };
}

/** A trivial round trip for the settings screen's "test" button. Throws with the provider's own message. */
export async function testLlm(settings: LlmSettings): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(chatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(settings.apiKey === '' ? {} : { Authorization: `Bearer ${settings.apiKey}` }),
      },
      body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 8 }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: unknown = null;
    try {
      body = raw === '' ? null : JSON.parse(raw);
    } catch {
      body = null;
    }
    if (!response.ok) throw new LlmError(response.status, readError(response.status, body, raw));
    return readAnswer(body);
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new LlmError(0, 'the endpoint did not answer within 20 s');
    throw new LlmError(0, e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
