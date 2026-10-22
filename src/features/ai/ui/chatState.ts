import type { TFunction } from 'i18next';

import { DAILY_FIELDS, type DailyField, type ToolSummary, type ToolTrace } from '../tools';
import { daysBetween } from '@/features/coach/time';
import type { AnswerEvent, AnswerStep } from '../answer';
import { CHAT_LIMITS, type ChatMessage, type StepRecord } from '../conversations';
import type { Engine, ProviderId } from '../types';

type AiT = TFunction<'ai'>;

// ---- live state of an answer being written ----

/** A tool step as the screen shows it: the stored record, plus whether it is still running. */
export interface StepView extends StepRecord {
  running: boolean;
}

/** What has arrived so far of the answer being written. Pure data, reduced from the engine's events. */
export interface LiveState {
  /** The text of the current provider call: cleared when the next call starts (what came before was a preamble to tool use). */
  text: string;
  reasoning: string;
  steps: StepView[];
  round: number;
}

export const LIVE_REASONING_CHARS = 6_000;

export const initialLive = (): LiveState => ({ text: '', reasoning: '', steps: [], round: 0 });

const stepOf = (id: string, trace: ToolTrace, summary: ToolSummary | null): StepView => ({
  id,
  tool: trace.tool,
  args: trace.args,
  count: summary?.count ?? null,
  empty: summary?.empty ?? false,
  failed: summary?.failed ?? false,
  notConnected: summary?.notConnected ?? false,
  running: summary === null,
});

/** One engine event applied to the live state. Never mutates; the screen keeps the result in a ref and shows it at a throttled pace. */
export function reduceLive(state: LiveState, event: AnswerEvent): LiveState {
  switch (event.type) {
    case 'round': {
      // A new provider call: its text replaces the preamble, and a new paragraph starts in the reasoning.
      const reasoning = state.reasoning !== '' && !state.reasoning.endsWith('\n\n') ? `${state.reasoning}\n\n` : state.reasoning;
      return { ...state, text: '', reasoning, round: event.round };
    }
    case 'text':
      return { ...state, text: state.text + event.delta };
    case 'reasoning':
      return { ...state, reasoning: (state.reasoning + event.delta).slice(0, LIVE_REASONING_CHARS) };
    case 'toolStart':
      if (state.steps.some((s) => s.id === event.id)) return state;
      return { ...state, steps: [...state.steps, stepOf(event.id, event.trace, null)] };
    case 'toolDone': {
      const done = stepOf(event.id, event.trace, event.summary);
      return state.steps.some((s) => s.id === event.id)
        ? { ...state, steps: state.steps.map((s) => (s.id === event.id ? done : s)) }
        : { ...state, steps: [...state.steps, done] };
    }
  }
}

/** The line shown while nothing of the answer text has arrived: the tool being read, thinking, or writing. */
export type LiveStatus = { kind: 'tool'; step: StepView } | { kind: 'reasoning' } | { kind: 'writing' };

export function liveStatus(state: LiveState): LiveStatus {
  const running = state.steps.find((s) => s.running);
  if (running) return { kind: 'tool', step: running };
  if (state.reasoning.trim() !== '' && state.text === '') return { kind: 'reasoning' };
  return { kind: 'writing' };
}

/** The steps as they are stored with the message. Running steps (the answer ended first) are dropped. */
export const toStepRecords = (steps: readonly (AnswerStep | StepView)[]): StepRecord[] =>
  steps.flatMap((s) => {
    if ('running' in s) {
      if (s.running) return [];
      return [{ id: s.id, tool: s.tool, args: s.args, count: s.count, empty: s.empty, failed: s.failed, notConnected: s.notConnected }];
    }
    return [{ id: s.id, tool: s.trace.tool, args: s.trace.args, count: s.summary.count, empty: s.summary.empty, failed: s.summary.failed, notConnected: s.summary.notConnected }];
  });

export interface AssistantParts {
  id: string;
  at: number;
  content: string;
  engine: Engine;
  provider?: ProviderId;
  model?: string;
  steps?: readonly (AnswerStep | StepView)[];
  reasoning?: string;
  proposed?: readonly string[];
  fixed?: boolean;
  tokens?: { input: number; output: number } | null;
  stopped?: boolean;
}

/** The assistant message to store: only the fields that carry something. */
export function assistantMessage(p: AssistantParts): ChatMessage {
  const steps = p.steps ? toStepRecords(p.steps) : [];
  const reasoning = (p.reasoning ?? '').trim().slice(0, CHAT_LIMITS.reasoningChars);
  const tokens = p.tokens && p.tokens.input + p.tokens.output > 0 ? p.tokens : null;
  return {
    id: p.id,
    role: 'assistant',
    content: p.content,
    at: p.at,
    engine: p.engine,
    ...(p.provider ? { provider: p.provider } : {}),
    ...(p.model ? { model: p.model } : {}),
    ...(steps.length > 0 ? { steps } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(p.proposed && p.proposed.length > 0 ? { proposed: [...p.proposed] } : {}),
    ...(p.fixed ? { fixed: true } : {}),
    ...(tokens ? { tokens } : {}),
    ...(p.stopped ? { stopped: true } : {}),
  };
}

/**
 * Stop pressed: what to keep of the answer. The text that had arrived (with the steps and reasoning so far), marked stopped; null when
 * no text arrived, and then nothing is added (the question stays).
 */
export function partialOnStop(state: LiveState): Pick<AssistantParts, 'content' | 'steps' | 'reasoning' | 'stopped'> | null {
  const content = state.text.trim();
  if (content === '') return null;
  return { content, steps: state.steps, reasoning: state.reasoning, stopped: true };
}

// ---- throttled commits ----

export interface CoalescerClock {
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/**
 * Turns a fast stream of changes into at most one `commit` per `intervalMs`. `schedule()` is called for every token (cheap),
 * `flush()` commits now (a tool started, the answer ended), `cancel()` drops a pending commit.
 */
export function createCoalescer(commit: () => void, intervalMs: number, clock: CoalescerClock) {
  let last = Number.NEGATIVE_INFINITY;
  let handle: unknown = null;
  const run = () => {
    handle = null;
    last = clock.now();
    commit();
  };
  return {
    schedule(): void {
      if (handle !== null) return;
      const wait = Math.max(0, intervalMs - (clock.now() - last));
      handle = clock.setTimer(run, wait);
    },
    flush(): void {
      if (handle !== null) clock.clearTimer(handle);
      run();
    },
    cancel(): void {
      if (handle !== null) clock.clearTimer(handle);
      handle = null;
    },
  };
}

// ---- words for the steps ----

const isField = (v: string): v is DailyField => (DAILY_FIELDS as readonly string[]).includes(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days of a `from`/`to` range from a call's arguments, at least 1; 0 when the dates are not usable. */
function spanOf(args: ToolTrace['args']): number {
  const from = String(args.from ?? '');
  const to = String(args.to ?? '');
  if (!DATE.test(from) || !DATE.test(to)) return 0;
  return Math.abs(daysBetween(from, to)) + 1;
}

const fieldLabel = (t: AiT, field: string): string => (isField(field) ? t(`steps.field.${field}`) : t('steps.field.all'));

/**
 * What a step reads, in plain words and without any health value ("Membaca tidur 14 hari"). A step that has just started has no
 * arguments yet, so it is worded by its tool name ("Membaca data harian").
 */
export function stepPhrase(step: Pick<StepRecord, 'tool' | 'args'>, t: AiT): string {
  const { tool, args } = step;
  const days = (n: number) => t('steps.days', { count: n });
  const range = (what: string) => {
    const n = spanOf(args);
    return n > 0 ? t('steps.readDays', { what, days: days(n) }) : t('steps.read', { what });
  };
  switch (tool) {
    case 'get_daily': {
      const raw = String(args.fields ?? 'all');
      const labels = raw === 'all' ? ['all'] : raw.split(',').filter(Boolean);
      return range([...new Set(labels.map((f) => fieldLabel(t, f)))].join(', '));
    }
    case 'get_trend': {
      if (!args.metric) return t('steps.trendAny');
      const n = Number(args.days) || 0;
      const what = fieldLabel(t, String(args.metric));
      return n > 0 ? t('steps.trend', { what, days: days(n) }) : t('steps.read', { what });
    }
    case 'get_nutrition':
      return range(t('steps.food'));
    case 'list_workouts':
      return range(t('steps.workoutList'));
    case 'get_sleep_night': {
      const date = String(args.date ?? '');
      return DATE.test(date) ? t('steps.night', { date }) : t('steps.nightAny');
    }
    case 'get_workout':
      return t('steps.workout');
    case 'get_plan':
      return t('steps.plan');
    case 'propose_note':
      return t('steps.note');
  }
}

/** The phrase of a step that is running now: "Membaca tidur 14 hari...". */
export const runningPhrase = (step: Pick<StepRecord, 'tool' | 'args'>, t: AiT): string => t('steps.running', { what: stepPhrase(step, t) });

/** The result on the right of a finished step: rows found, nothing, failed, or needing the JoyoRogo sign-in. */
export function stepResult(step: Pick<StepRecord, 'count' | 'empty' | 'failed' | 'notConnected'>, t: AiT): string {
  if (step.notConnected) return t('steps.result.notConnected');
  if (step.failed) return t('steps.result.failed');
  if (step.empty) return t('steps.result.empty');
  if (step.count !== null) return t('steps.result.rows', { count: step.count });
  return t('steps.result.done');
}

/** The exact call, for the expanded row: tool name and plain arguments, never a value read. */
export function stepCall(step: Pick<StepRecord, 'tool' | 'args'>): string {
  const args = Object.entries(step.args)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
  return `${step.tool}(${args})`;
}

// ---- conversations ----

/** The title to show for a conversation; `fallback` ("Percakapan baru") while it has none. */
export const displayTitle = (title: string, fallback: string): string => (title.trim() === '' ? fallback : title);

/** Epoch milliseconds (the store's clock) as unix seconds (`formatAgo`'s clock). */
export const toSeconds = (ms: number): number => Math.floor(ms / 1000);

export const lastIndexOfRole = (messages: readonly ChatMessage[], role: ChatMessage['role']): number => {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i]!.role === role) return i;
  return -1;
};

// ---- following the stream ----

export interface ScrollMetrics {
  offsetY: number;
  viewportH: number;
  contentH: number;
}

/** How far the end of the content is below the visible area. */
export const distanceFromBottom = (m: ScrollMetrics): number => Math.max(0, m.contentH - (m.offsetY + m.viewportH));

export const NEAR_BOTTOM_PX = 64;

/** Further than this from the newest message (in an inverted list: the offset) counts as scrolled away: the "Ke terbaru" button shows and the answer being written is held back. */
export const AWAY_PX = 160;
/** Back within this of the newest message counts as there again (smaller than {@link AWAY_PX} so the state does not flicker at the edge). */
export const BACK_PX = 80;

/** The next away state for a scroll offset, with hysteresis between {@link BACK_PX} and {@link AWAY_PX}. */
export const nextAway = (was: boolean, offset: number): boolean => (was ? offset > BACK_PX : offset > AWAY_PX);

/**
 * How far to move the offset when the content height changed. Only while the person is away from the newest message and the change
 * is the newest message changing (the compensation window is open): content that grows at the newest end pushes everything older
 * away from offset 0, so the same offset would show different text. Returns 0 otherwise (never moves a list the person is not
 * reading older text in, and never reacts to a shrink).
 */
export const shiftOnGrowth = (a: { prev: number; next: number; offset: number; away: boolean; windowOpen: boolean }): number =>
  a.away && a.windowOpen && a.prev > 0 && a.next > a.prev && a.offset > 0 ? a.next - a.prev : 0;

/** Room under the newest message while "Ke terbaru" floats over the list: the button's height plus its gap to the composer. */
export const JUMP_ROOM_PX = 52;

/**
 * The room for the button appears and goes away with it, which moves everything at the same offset by that much. When a change of the
 * content height is exactly that room, the signed distance to move the offset so what the person reads stays where it was; else 0.
 */
export const roomShift = (delta: number): number => (Math.abs(Math.abs(delta) - JUMP_ROOM_PX) < 1 ? delta : 0);

/** True when the person is at the end of the chat (or close enough that new text should keep it in view). */
export const isNearBottom = (m: ScrollMetrics, threshold: number = NEAR_BOTTOM_PX): boolean => distanceFromBottom(m) <= threshold;

// ---- opening a chat from elsewhere ----

export type SeedKind = 'workout' | 'sleep';

export interface Seed {
  kind: SeedKind;
  ref: string;
  label: string;
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
const WORKOUT_REF = /^[A-Za-z0-9:._-]{1,64}$/;

/** The route params of an entry point ("debrief this workout", "this night") as a seed, or null when absent or malformed. */
export function parseSeed(params: { seed?: string | string[]; ref?: string | string[]; label?: string | string[] }): Seed | null {
  const kind = first(params.seed);
  const ref = first(params.ref).trim();
  if (kind !== 'workout' && kind !== 'sleep') return null;
  if (kind === 'sleep' ? !DATE.test(ref) : !WORKOUT_REF.test(ref)) return null;
  const label = first(params.label).replace(/\s+/g, ' ').trim().slice(0, 80);
  return { kind, ref, label: label || ref };
}

/** The text put in the box for a seed (never sent by itself): it carries the ref so the model reads that workout or night. */
export const seedText = (seed: Seed, t: AiT): string => t(`seed.${seed.kind}`, { label: seed.label, ref: seed.ref });

// ---- streaming text: a settled part and a growing tail ----

/**
 * Splits streamed text at its last blank line that is not inside a code fence: everything before it is finished paragraphs (parsed and
 * drawn once, then left alone), the rest is the paragraph still being written (the only part that is parsed and drawn again on each
 * update). A long answer therefore costs the same per update as a short one.
 */
export function splitStable(text: string): { head: string; tail: string } {
  let open = false;
  let cut = -1;
  let pos = 0;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) open = !open;
    else if (line.trim() === '' && !open && pos > 0) cut = pos;
    pos += line.length + 1;
  }
  // `cut` is the start of the last blank line; the head ends before it and the tail starts after it.
  if (cut <= 0) return { head: '', tail: text };
  const head = text.slice(0, cut).replace(/\n+$/, '');
  const tail = text.slice(cut).replace(/^\n+/, '');
  return head === '' ? { head: '', tail: text } : { head, tail };
}
