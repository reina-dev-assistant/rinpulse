import { describe, expect, test } from 'bun:test';

import type { ByokAccess } from './access';
import { joyoAiDestination, type ChatSeed, type OpenState } from './open';

const ready: ByokAccess = { ok: true, provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'm' };
const blocked: ByokAccess = { ok: false, reason: 'noProvider' };
const seed: ChatSeed = { seed: 'workout', ref: 'w:1729500000', label: 'Lari 21 Okt' };
const state = (over: Partial<OpenState>): OpenState => ({ settings: { engine: 'rogo', provider: null }, access: blocked, coachAccess: 'free', ...over });

describe('where a Joyo AI shortcut leads', () => {
  test('nothing set up and not Pro: the setup screen, with or without a seed', () => {
    expect(joyoAiDestination(state({}))).toEqual({ pathname: '/settings/ai-setup' });
    expect(joyoAiDestination(state({ coachAccess: 'signedOut' }), seed)).toEqual({ pathname: '/settings/ai-setup' });
  });
  test('Pro on the hosted engine: the chat, seed passed as params', () => {
    expect(joyoAiDestination(state({ coachAccess: 'pro' }))).toEqual({ pathname: '/joyo/chat' });
    expect(joyoAiDestination(state({ coachAccess: 'pro' }), seed)).toEqual({ pathname: '/joyo/chat', params: { seed: 'workout', ref: 'w:1729500000', label: 'Lari 21 Okt' } });
  });
  test('own key ready and chosen: the chat even without Pro', () => {
    expect(joyoAiDestination(state({ settings: { engine: 'byok', provider: 'openrouter' }, access: ready }))).toEqual({ pathname: '/joyo/chat' });
  });
  test('own key ready but the hosted engine is chosen and the account is not Pro: the settings, to switch engine', () => {
    expect(joyoAiDestination(state({ access: ready }))).toEqual({ pathname: '/settings/ai' });
  });
  test('own key chosen but not usable and no Pro: setup (under 18 reads the explanation there)', () => {
    expect(joyoAiDestination(state({ settings: { engine: 'byok', provider: 'openai' }, access: { ok: false, reason: 'minor' } }))).toEqual({ pathname: '/settings/ai-setup' });
  });
  test('own key chosen but blocked while the account is Pro: the chat shows the reason', () => {
    expect(joyoAiDestination(state({ settings: { engine: 'byok', provider: 'openai' }, access: { ok: false, reason: 'noConsent' }, coachAccess: 'pro' }))).toEqual({ pathname: '/joyo/chat' });
  });
  test('still reading the age or the account: the chat opens and shows its own checking state', () => {
    expect(joyoAiDestination(state({ access: null }))).toEqual({ pathname: '/joyo/chat' });
    expect(joyoAiDestination(state({ coachAccess: 'checking' }))).toEqual({ pathname: '/joyo/chat' });
  });
});
