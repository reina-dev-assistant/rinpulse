import { describe, expect, test } from 'bun:test';

import type { ChatTurn } from './api';
import { chatCompletionsUrl } from './localClient';
import type { CoachSnapshot } from './snapshot';

/**
 * The URL builder and the request shape, without a network. The reply parsing needs `fetch`, so it is exercised
 * with a stub rather than left to a live provider: a wrong shape check there means "the endpoint returned no
 * answer" on a perfectly good response.
 */
const snapshot: CoachSnapshot = {
  generatedAt: 0,
  today: '2026-10-21',
  readiness: null,
  load: null,
  hrv: null,
  sleep: null,
  strain: null,
  restingHr: null,
  vo2max: null,
  suggestion: null,
  plan: null,
  workouts: [],
};

const turns: ChatTurn[] = [{ role: 'user', content: 'Halo' }];

describe('chatCompletionsUrl', () => {
  test('appends the path to an OpenAI-style base URL', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
  });

  test('tolerates a trailing slash', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
    expect(chatCompletionsUrl('https://api.openai.com/v1///')).toBe('https://api.openai.com/v1/chat/completions');
  });

  test('keeps a self-hosted path', () => {
    // Ollama and LM Studio are commonly reached on a path of their own; trimming it would break them.
    expect(chatCompletionsUrl('http://192.168.1.5:11434/v1')).toBe('http://192.168.1.5:11434/v1/chat/completions');
  });
});

describe('localChat request shape', () => {
  test('sends the system prompt, the model and the token cap, and reads the reply', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ choices: [{ message: { content: '  Easy 30 menit.  ' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      // Imported lazily so the stub is in place first.
      const { localChat } = await import('./localClient');
      const answer = await localChat(turns, snapshot, {
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        apiKey: 'sk-test',
        temperature: 0.4,
        maxTokens: 700,
      });

      expect(answer.reply).toBe('Easy 30 menit.');
      // A personal endpoint has no server accounting, so the counter stays hidden rather than showing a fake cap.
      expect(answer.cap).toBe(0);
      expect(answer.used).toBe(0);
      // The server's injury keyword screen is gone with the server; nothing may claim it ran.
      expect(answer.flagged).toBeNull();

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://api.example.com/v1/chat/completions');
      const headers = calls[0]?.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test');
      const body = JSON.parse(String(calls[0]?.init.body)) as { model: string; messages: { role: string }[]; max_tokens: number };
      expect(body.model).toBe('test-model');
      expect(body.max_tokens).toBe(700);
      expect(body.messages[0]?.role).toBe('system');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('sends no Authorization header when no key is set, so a local server works', async () => {
    const calls: { init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init: init ?? {} });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
    }) as typeof fetch;

    try {
      const { localChat } = await import('./localClient');
      await localChat(turns, snapshot, {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3',
        apiKey: '',
        temperature: 0.4,
        maxTokens: 700,
      });
      const headers = calls[0]?.init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a provider error surfaces the provider's own message, not a generic one", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 })) as typeof fetch;

    try {
      const { LlmError, localChat } = await import('./localClient');
      await expect(
        localChat(turns, snapshot, { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'bad', temperature: 0.4, maxTokens: 700 }),
      ).rejects.toThrow('Incorrect API key provided');
      // 401 is the case a wearer will hit first with a wrong key, so it must not be swallowed.
      await localChat(turns, snapshot, { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'bad', temperature: 0.4, maxTokens: 700 }).catch(
        (e: unknown) => {
          expect(e).toBeInstanceOf(LlmError);
          expect((e as InstanceType<typeof LlmError>).status).toBe(401);
        },
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  test('an empty answer is an error, not a blank bubble', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), { status: 200 })) as typeof fetch;

    try {
      const { localChat } = await import('./localClient');
      await expect(
        localChat(turns, snapshot, { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: '', temperature: 0.4, maxTokens: 700 }),
      ).rejects.toThrow('empty answer');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('a wrong shape is reported instead of crashing', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: 'something else' }), { status: 200 })) as typeof fetch;

    try {
      const { localChat } = await import('./localClient');
      await expect(
        localChat(turns, snapshot, { baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: '', temperature: 0.4, maxTokens: 700 }),
      ).rejects.toThrow('no answer');
    } finally {
      globalThis.fetch = original;
    }
  });
});
