import { describe, expect, test } from 'bun:test';

import { CHAT_LIMITS, chatLines, createChatStore, LEGACY_CHAT_KEY, titleOf, toMessage, type ChatMessage } from './conversations';
import { memoryKv } from './kv';

function store(start = 1_000_000) {
  const kv = memoryKv();
  let clock = start;
  let n = 0;
  const chats = createChatStore(kv, { now: () => (clock += 1000), newId: () => `c${n++}` });
  return { kv, chats };
}

const user = (id: string, content: string): ChatMessage => ({ id, role: 'user', content, at: 1 });
const bot = (id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'assistant', content, at: 2, ...extra });

describe('conversation store', () => {
  test('create, save messages, read back; the title comes from the first question', () => {
    const { chats } = store();
    const created = chats.create();
    expect(created.title).toBe('');
    chats.setMessages(created.id, [user('a', 'Kenapa HRV-ku turun minggu ini?'), bot('b', 'Karena tidurmu pendek.', { engine: 'byok', provider: 'openrouter', model: 'm', steps: [{ id: 's', tool: 'get_trend', args: { metric: 'hrvMs', days: 14 }, count: 14, empty: false, failed: false, notConnected: false }] })]);
    const read = chats.get(created.id)!;
    expect(read.title).toBe('Kenapa HRV-ku turun minggu ini?');
    expect(read.messages).toHaveLength(2);
    expect(read.messages[1]).toMatchObject({ engine: 'byok', provider: 'openrouter', steps: [{ tool: 'get_trend', count: 14 }] });
    expect(chats.list()[0]).toMatchObject({ id: created.id, messageCount: 2 });
    expect(chats.current()).toBe(created.id);
  });

  test('the list is newest first and a long title is cut with an ellipsis', () => {
    const { chats } = store();
    const a = chats.create('pertama');
    const b = chats.create('x'.repeat(200));
    chats.setMessages(a.id, [user('1', 'pertama')]);
    expect(chats.list().map((m) => m.id)).toEqual([a.id, b.id]);
    expect(chats.get(b.id)!.title.length).toBe(CHAT_LIMITS.titleChars);
    expect(chats.get(b.id)!.title.endsWith('\u2026')).toBe(true);
    expect(titleOf('a\nb\tc')).toBe('a b c');
  });

  test('truncateFrom keeps what came before: the base of edit-and-resend and regenerate', () => {
    const { chats } = store();
    const c = chats.create('q');
    chats.setMessages(c.id, [user('1', 'q1'), bot('2', 'a1'), user('3', 'q2'), bot('4', 'a2')]);
    expect(chats.truncateFrom(c.id, '4').map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(chats.truncateFrom(c.id, '3').map((m) => m.id)).toEqual(['1', '2']);
    expect(chats.get(c.id)!.messages.map((m) => m.id)).toEqual(['1', '2']);
    expect(chats.truncateFrom(c.id, 'nope').map((m) => m.id)).toEqual(['1', '2']);
    expect(chats.truncateFrom('missing', '1')).toEqual([]);
  });

  test('remove forgets one conversation and its current mark; clearAll forgets everything, also the earlier single chat', () => {
    const { chats, kv } = store();
    const a = chats.create('a');
    const b = chats.create('b');
    chats.remove(b.id);
    expect(chats.list().map((m) => m.id)).toEqual([a.id]);
    expect(chats.current()).toBeNull();
    kv.setItem(LEGACY_CHAT_KEY, '[]');
    chats.clearAll();
    expect(chats.list()).toEqual([]);
    expect(Object.keys(kv.dump())).toEqual([]);
  });

  test('limits: 30 conversations (the oldest go), 80 messages, 8,000 characters a message', () => {
    const { chats, kv } = store();
    const first = chats.create('first');
    for (let i = 0; i < CHAT_LIMITS.conversations + 2; i++) chats.create(`c${i}`);
    expect(chats.list()).toHaveLength(CHAT_LIMITS.conversations);
    expect(chats.get(first.id)).toBeNull();
    expect(kv.getItem(`joyofit.ai.chat.${first.id}`)).toBeNull();
    const c = chats.create('long');
    const many = Array.from({ length: 100 }, (_, i) => user(`m${i}`, 'x'.repeat(9000)));
    chats.setMessages(c.id, many);
    const read = chats.get(c.id)!;
    expect(read.messages).toHaveLength(CHAT_LIMITS.messages);
    expect(read.messages[0]!.content.length).toBe(CHAT_LIMITS.contentChars);
  });

  test('a damaged store is an empty list, not a crash; a damaged conversation is an empty chat', () => {
    const { chats, kv } = store();
    kv.setItem('joyofit.ai.chats', '{oops');
    expect(chats.list()).toEqual([]);
    const c = chats.create('ok');
    kv.setItem(`joyofit.ai.chat.${c.id}`, 'garbage');
    expect(chats.get(c.id)!.messages).toEqual([]);
    kv.setItem(`joyofit.ai.chat.${c.id}`, JSON.stringify({ messages: [{ role: 'user' }, 5, { role: 'user', content: 'ok' }] }));
    expect(chats.get(c.id)!.messages.map((m) => m.content)).toEqual(['ok']);
  });

  test('subscribers hear every change', () => {
    const { chats } = store();
    let heard = 0;
    const off = chats.subscribe(() => (heard += 1));
    const c = chats.create('a');
    chats.setMessages(c.id, [user('1', 'a')]);
    chats.remove(c.id);
    off();
    chats.create('b');
    expect(heard).toBeGreaterThanOrEqual(3);
    const after = heard;
    chats.create('c');
    expect(heard).toBe(after);
  });
});

describe('moving the single chat of the earlier version', () => {
  test('the first read turns it into a conversation with a title and keeps its notes, steps and model; the old key is gone', () => {
    const { chats, kv } = store();
    kv.setItem(
      LEGACY_CHAT_KEY,
      JSON.stringify([
        { role: 'user', content: 'Review minggu ini' },
        { role: 'assistant', content: 'Minggu ini bagus.', trace: [{ tool: 'get_trend', args: { metric: 'hrvMs', days: 14 } }], provider: 'openai', model: 'gpt-6-luna', proposed: ['Target 10K'] },
        { role: 'nonsense' },
      ]),
    );
    const list = chats.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Review minggu ini', messageCount: 2 });
    expect(kv.getItem(LEGACY_CHAT_KEY)).toBeNull();
    const read = chats.get(list[0]!.id)!;
    expect(read.messages[1]).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', proposed: ['Target 10K'], steps: [{ tool: 'get_trend', args: { metric: 'hrvMs', days: 14 } }] });
    expect(chats.current()).toBe(list[0]!.id);
    expect(chats.list()).toHaveLength(1);
  });

  test('an empty or broken old chat makes no conversation', () => {
    const empty = store();
    empty.kv.setItem(LEGACY_CHAT_KEY, '[]');
    expect(empty.chats.list()).toEqual([]);
    const broken = store();
    broken.kv.setItem(LEGACY_CHAT_KEY, 'not json');
    expect(broken.chats.list()).toEqual([]);
    expect(broken.kv.getItem(LEGACY_CHAT_KEY)).toBeNull();
  });
});

describe('messages', () => {
  test('toMessage keeps valid optional fields and drops the rest', () => {
    const m = toMessage({ role: 'assistant', content: 'x', engine: 'nope', provider: 'openai', stopped: true, fixed: 'yes', reasoning: 'r'.repeat(5000), tokens: { input: 1, output: 2 }, steps: [{ tool: 'evil_tool' }, { tool: 'get_plan', args: { a: { b: 1 } } }] }, 'id0', 5)!;
    expect(m).toMatchObject({ id: 'id0', at: 5, provider: 'openai', stopped: true, tokens: { input: 1, output: 2 } });
    expect(m.engine).toBeUndefined();
    expect(m.fixed).toBeUndefined();
    expect(m.reasoning!.length).toBe(CHAT_LIMITS.reasoningChars);
    expect(m.steps).toEqual([{ id: 's1', tool: 'get_plan', args: {}, count: null, empty: false, failed: false, notConnected: false }]);
    expect(toMessage({ role: 'system', content: 'x' }, 'i', 0)).toBeNull();
  });

  test('chatLines hands the engines role and text only', () => {
    expect(chatLines([user('1', 'a'), bot('2', 'b', { model: 'm', steps: [], reasoning: 'secret thoughts' })])).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
  });
});
