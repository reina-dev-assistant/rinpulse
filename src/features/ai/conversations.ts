import { flat } from './digest';
import { isRecord } from './json';
import { readJson, type KvStore } from './kv';
import { PROVIDER_IDS, type Engine, type ProviderId } from './types';
import { TOOL_NAMES, type ToolName } from './tools';

/**
 * The conversations of Joyo AI, on this phone only (never synced, never sent anywhere but as the turns of a question). Several
 * chats with titles, like any chat app: an index of small records under `joyofit.ai.chats` and one entry per chat under
 * `joyofit.ai.chat.<id>`, so opening the list never parses every message. The single saved chat of the earlier version
 * (`joyofit.coach.chat`) is moved into the first conversation the first time the list is read.
 */
export const CHAT_LIMITS = { conversations: 30, messages: 80, contentChars: 8_000, reasoningChars: 2_000, titleChars: 48, proposed: 5 } as const;

const INDEX_KEY = 'joyofit.ai.chats';
const CURRENT_KEY = 'joyofit.ai.chatcur';
const chatKey = (id: string): string => `joyofit.ai.chat.${id}`;
/** The key of the single saved conversation of the version before several chats. */
export const LEGACY_CHAT_KEY = 'joyofit.coach.chat';

/** A tool the answer ran: what was read (plain arguments, never values) and how it went. */
export interface StepRecord {
  id: string;
  tool: ToolName;
  args: Record<string, string | number>;
  count: number | null;
  empty: boolean;
  failed: boolean;
  notConnected: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Epoch milliseconds. */
  at: number;
  /** Which engine wrote an assistant message. */
  engine?: Engine;
  provider?: ProviderId;
  model?: string;
  steps?: StepRecord[];
  /** The model's reasoning, capped; shown collapsed, never part of the answer and never sent back. */
  reasoning?: string;
  /** Notes the model suggested that the person has not answered yet. */
  proposed?: string[];
  /** The fixed safety answer: no provider was called. */
  fixed?: boolean;
  /** The person pressed Stop: this is the partial text that had arrived. */
  stopped?: boolean;
  /** Tokens of the question that produced this answer, from the provider's own count. */
  tokens?: { input: number; output: number };
}

export interface ConversationMeta {
  id: string;
  /** Empty until the first question is sent; the screen shows its own "new chat" label then. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** The person named it themselves: the first question no longer sets the title. */
  custom?: boolean;
}

export interface Conversation extends ConversationMeta {
  messages: ChatMessage[];
}

/** A title from the first question: one line, trimmed, with an ellipsis when cut. */
export function titleOf(text: string): string {
  const one = flat(text, 400);
  if (one.length <= CHAT_LIMITS.titleChars) return one;
  return `${one.slice(0, CHAT_LIMITS.titleChars - 1).trimEnd()}\u2026`;
}

/** The turns as the engines take them: role and text only, nothing else leaves the phone. */
export const chatLines = (messages: readonly ChatMessage[]): { role: 'user' | 'assistant'; content: string }[] =>
  messages.map(({ role, content }) => ({ role, content }));

const isEngine = (v: unknown): v is Engine => v === 'rogo' || v === 'byok';
const isProvider = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);
const isTool = (v: unknown): v is ToolName => typeof v === 'string' && (TOOL_NAMES as readonly string[]).includes(v);

function toStep(raw: unknown, index: number): StepRecord | null {
  if (!isRecord(raw) || !isTool(raw.tool)) return null;
  const args: Record<string, string | number> = {};
  if (isRecord(raw.args)) for (const [k, v] of Object.entries(raw.args)) if (typeof v === 'string' || typeof v === 'number') args[k.slice(0, 24)] = typeof v === 'string' ? v.slice(0, 60) : v;
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 64) : `s${index}`,
    tool: raw.tool,
    args,
    count: typeof raw.count === 'number' ? raw.count : null,
    empty: raw.empty === true,
    failed: raw.failed === true,
    notConnected: raw.notConnected === true,
  };
}

/** One stored value as a message, keeping the fields that are valid; null when it is not a message. */
export function toMessage(raw: unknown, fallbackId: string, fallbackAt: number): ChatMessage | null {
  if (!isRecord(raw) || (raw.role !== 'user' && raw.role !== 'assistant') || typeof raw.content !== 'string') return null;
  const message: ChatMessage = {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id.slice(0, 40) : fallbackId,
    role: raw.role,
    content: raw.content.slice(0, CHAT_LIMITS.contentChars),
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : fallbackAt,
  };
  if (isEngine(raw.engine)) message.engine = raw.engine;
  if (isProvider(raw.provider)) message.provider = raw.provider;
  if (typeof raw.model === 'string') message.model = raw.model.slice(0, 200);
  if (raw.fixed === true) message.fixed = true;
  if (raw.stopped === true) message.stopped = true;
  if (typeof raw.reasoning === 'string' && raw.reasoning !== '') message.reasoning = raw.reasoning.slice(0, CHAT_LIMITS.reasoningChars);
  // Legacy turns kept `trace`: tool names and dates only, which is a step without a result.
  const stepSource = Array.isArray(raw.steps) ? raw.steps : Array.isArray(raw.trace) ? raw.trace.map((t) => (isRecord(t) ? { ...t } : t)) : null;
  if (stepSource) {
    const steps = stepSource.map(toStep).filter((s): s is StepRecord => s !== null);
    if (steps.length > 0) message.steps = steps;
  }
  if (Array.isArray(raw.proposed)) {
    const proposed = raw.proposed.filter((n): n is string => typeof n === 'string' && n !== '').slice(0, CHAT_LIMITS.proposed);
    if (proposed.length > 0) message.proposed = proposed;
  }
  if (isRecord(raw.tokens) && typeof raw.tokens.input === 'number' && typeof raw.tokens.output === 'number') message.tokens = { input: raw.tokens.input, output: raw.tokens.output };
  return message;
}

const validIndex = (v: unknown): v is unknown[] => Array.isArray(v);

function toMeta(raw: unknown): ConversationMeta | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id.slice(0, 40),
    title: typeof raw.title === 'string' ? raw.title.slice(0, CHAT_LIMITS.titleChars) : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    messageCount: typeof raw.messageCount === 'number' ? raw.messageCount : 0,
    ...(raw.custom === true ? { custom: true } : {}),
  };
}

export interface ChatStoreDeps {
  now?: () => number;
  newId?: () => string;
}

export interface ChatStore {
  /** Newest first. */
  list(): ConversationMeta[];
  get(id: string): Conversation | null;
  /** The chat the person had open last, or null (then the screen starts a new one). */
  current(): string | null;
  setCurrent(id: string | null): void;
  /** A new conversation, saved at once; its title comes from the first question. */
  create(firstQuestion?: string): Conversation;
  /** Replaces the messages of a conversation (after a send, an edit or a regenerate). Fills in the title from the first question when it has none. */
  setMessages(id: string, messages: readonly ChatMessage[]): Conversation | null;
  rename(id: string, title: string): void;
  /** Drops `messageId` and every message after it: the base of "edit and resend" and "regenerate". Returns the messages that were kept. */
  truncateFrom(id: string, messageId: string): ChatMessage[];
  remove(id: string): void;
  /** Every conversation, and the earlier single chat if it was never moved. */
  clearAll(): void;
  subscribe(listener: () => void): () => void;
  newMessageId(): string;
}

/** The conversation store. Reads never throw: a damaged entry is an empty chat or is left out of the list. */
export function createChatStore(kv: KvStore, deps: ChatStoreDeps = {}): ChatStore {
  const now = deps.now ?? Date.now;
  let counter = 0;
  const newId = deps.newId ?? (() => `c${now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`);
  const listeners = new Set<() => void>();
  let migrated = false;
  const changed = () => {
    for (const listener of listeners) listener();
  };

  const readIndex = (): ConversationMeta[] =>
    readJson<unknown[]>(kv, INDEX_KEY, [], validIndex)
      .map(toMeta)
      .filter((m): m is ConversationMeta => m !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  const writeIndex = (index: ConversationMeta[]): void => kv.setItem(INDEX_KEY, JSON.stringify(index));

  const read = (id: string): Conversation | null => {
    const meta = readIndex().find((m) => m.id === id);
    if (!meta) return null;
    const raw = readJson<unknown>(kv, chatKey(id), null, (v): v is unknown => true);
    const list = isRecord(raw) && Array.isArray(raw.messages) ? raw.messages : [];
    const messages = list.map((m, i) => toMessage(m, `m${i}`, meta.createdAt)).filter((m): m is ChatMessage => m !== null);
    return { ...meta, messages };
  };

  const save = (conversation: Conversation): Conversation => {
    const messages = conversation.messages.slice(-CHAT_LIMITS.messages);
    const meta: ConversationMeta = { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: now(), messageCount: messages.length, ...(conversation.custom ? { custom: true } : {}) };
    kv.setItem(chatKey(conversation.id), JSON.stringify({ messages }));
    let index = [...readIndex().filter((m) => m.id !== meta.id), meta].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const dropped of index.slice(CHAT_LIMITS.conversations)) kv.removeItem(chatKey(dropped.id));
    index = index.slice(0, CHAT_LIMITS.conversations);
    writeIndex(index);
    changed();
    return { ...meta, messages };
  };

  /** The single chat of the earlier version becomes the first conversation (once). */
  const migrateLegacy = (): void => {
    if (migrated) return;
    migrated = true;
    const raw = kv.getItem(LEGACY_CHAT_KEY);
    if (raw === null) return;
    kv.removeItem(LEGACY_CHAT_KEY);
    let list: unknown[] = [];
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) list = value;
    } catch {
      list = [];
    }
    const at = now();
    const messages = list.map((m, i) => toMessage(m, `l${i}`, at - (list.length - i) * 1000)).filter((m): m is ChatMessage => m !== null);
    if (messages.length === 0) return;
    const firstUser = messages.find((m) => m.role === 'user');
    const created = save({ id: newId(), title: titleOf(firstUser?.content ?? ''), createdAt: at, updatedAt: at, messageCount: messages.length, messages });
    kv.setItem(CURRENT_KEY, created.id);
  };

  return {
    list(): ConversationMeta[] {
      migrateLegacy();
      return readIndex();
    },
    get(id: string): Conversation | null {
      migrateLegacy();
      return read(id);
    },
    /** The chat the person had open last, or null (then the screen starts a new one). */
    current(): string | null {
      migrateLegacy();
      const id = kv.getItem(CURRENT_KEY);
      return id !== null && readIndex().some((m) => m.id === id) ? id : null;
    },
    setCurrent(id: string | null): void {
      if (id === null) kv.removeItem(CURRENT_KEY);
      else kv.setItem(CURRENT_KEY, id);
      changed();
    },
    /** A new conversation, saved at once; its title comes from the first question. */
    create(firstQuestion = ''): Conversation {
      migrateLegacy();
      const at = now();
      const created = save({ id: newId(), title: titleOf(firstQuestion), createdAt: at, updatedAt: at, messageCount: 0, messages: [] });
      kv.setItem(CURRENT_KEY, created.id);
      return created;
    },
    /** Replaces the messages of a conversation (after a send, an edit or a regenerate). Fills in the title from the first question when it has none. */
    setMessages(id: string, messages: readonly ChatMessage[]): Conversation | null {
      const conversation = read(id);
      if (!conversation) return null;
      const firstUser = messages.find((m) => m.role === 'user');
      // The first question names the chat (also after it was edited), unless the person gave it a name.
      const title = conversation.custom ? conversation.title : firstUser ? titleOf(firstUser.content) : conversation.title;
      return save({ ...conversation, title, messages: messages.map((m) => ({ ...m, content: m.content.slice(0, CHAT_LIMITS.contentChars) })) });
    },
    rename(id: string, title: string): void {
      const conversation = read(id);
      if (!conversation) return;
      // An empty name goes back to the first question.
      const clean = titleOf(title);
      const first = conversation.messages.find((m) => m.role === 'user');
      save({ ...conversation, title: clean !== '' ? clean : titleOf(first?.content ?? ''), custom: clean !== '' });
    },
    /** Drops `messageId` and every message after it: the base of "edit and resend" and "regenerate". Returns the messages that were kept. */
    truncateFrom(id: string, messageId: string): ChatMessage[] {
      const conversation = read(id);
      if (!conversation) return [];
      const at = conversation.messages.findIndex((m) => m.id === messageId);
      if (at === -1) return conversation.messages;
      const kept = conversation.messages.slice(0, at);
      save({ ...conversation, messages: kept });
      return kept;
    },
    remove(id: string): void {
      kv.removeItem(chatKey(id));
      writeIndex(readIndex().filter((m) => m.id !== id));
      if (kv.getItem(CURRENT_KEY) === id) kv.removeItem(CURRENT_KEY);
      changed();
    },
    /** Every conversation, and the earlier single chat if it was never moved. */
    clearAll(): void {
      for (const meta of readIndex()) kv.removeItem(chatKey(meta.id));
      kv.removeItem(INDEX_KEY);
      kv.removeItem(CURRENT_KEY);
      kv.removeItem(LEGACY_CHAT_KEY);
      changed();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    newMessageId: (): string => `m${now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  };
}
