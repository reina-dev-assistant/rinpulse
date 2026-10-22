import { addDays, daysBetween } from '@/features/coach/time';
import { flat, NOTE_MAX_CHARS, type DigestDay, type DigestWorkout } from './digest';
import type { ToolCall, ToolSpec } from './types';

/**
 * The tools of Joyo AI: eight, all read-only and run on the phone, defined once in a neutral schema and translated per provider by
 * the adapters. The model never gets a tool that sends anything out or changes anything: `propose_note` only returns a suggestion
 * that the person must tap to save. Ranges are capped (90 days, 200 rows), a result is capped (6,000 characters), free text goes
 * through `flat()`, and arithmetic (`get_trend`) is done here so the model does not do it.
 */
export const TOOL_LIMITS = { maxDays: 90, maxRows: 200, resultChars: 6_000, nutritionDays: 14, workoutRows: 30 } as const;

export const TOOL_NAMES = ['get_daily', 'get_trend', 'get_sleep_night', 'list_workouts', 'get_workout', 'get_nutrition', 'get_plan', 'propose_note'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const DAILY_FIELDS = ['sleepMin', 'sleepScore', 'restBpm', 'hrvMs', 'strain', 'steps', 'activeKcal', 'exerciseMin', 'weightKg', 'eatKcal', 'proteinG'] as const;
export type DailyField = (typeof DAILY_FIELDS)[number];
const FOOD_FIELDS: readonly DailyField[] = ['eatKcal', 'proteinG'];

const DATE = { type: 'string', description: 'Local date, YYYY-MM-DD' } as const; // i18n-ok: model-facing text

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'get_daily',
    description: 'Daily values per local day (null = not recorded). At most 90 days. eatKcal and proteinG cover at most 14 days and need JoyoRogo.', // i18n-ok: model-facing text
    parameters: {
      type: 'object',
      properties: {
        from: DATE,
        to: DATE,
        fields: { type: 'array', items: { type: 'string', enum: [...DAILY_FIELDS] }, description: 'Which values; all when omitted' }, // i18n-ok: model-facing text
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_trend',
    description: 'Mean, min, max and the change against the previous period of one daily metric over the last N days (7 to 90), computed by the app.',
    parameters: {
      type: 'object',
      properties: { metric: { type: 'string', enum: [...DAILY_FIELDS] }, days: { type: 'integer', minimum: 7, maximum: 90 } },
      required: ['metric', 'days'],
    },
  },
  {
    name: 'get_sleep_night',
    description: 'One night of sleep (the night that ended on this date): onset, wake, minutes per stage or stages "none", awakenings, overnight HRV and resting heart rate.', // i18n-ok: model-facing text
    parameters: { type: 'object', properties: { date: DATE }, required: ['date'] },
  },
  {
    name: 'list_workouts',
    description: 'Workouts between two dates, newest first (at most 30), with the same fields as the data block.', // i18n-ok: model-facing text
    parameters: { type: 'object', properties: { from: DATE, to: DATE, sport: { type: 'string', description: 'Optional sport name filter' } }, required: ['from', 'to'] }, // i18n-ok: model-facing text
  },
  {
    name: 'get_workout',
    description: 'Details of one workout by its id from the data block or list_workouts: heart rate zones, effect, recovery, splits, laps.', // i18n-ok: model-facing text
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'get_nutrition',
    description: 'Food totals per day (kcal, protein, carbs, fat, meals) for at most 14 days. Answers not_connected when the person is not signed in to JoyoRogo.', // i18n-ok: model-facing text
    parameters: { type: 'object', properties: { from: DATE, to: DATE }, required: ['from', 'to'] },
  },
  {
    name: 'get_plan',
    description: 'The active training plan: goal, level, week, this week\'s progress and the next sessions.', // i18n-ok: model-facing text
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'propose_note',
    description: 'Suggest a short note about the person (an injury, a goal, a preference) to remember. Nothing is saved until the person taps to confirm.', // i18n-ok: model-facing text
    parameters: { type: 'object', properties: { text: { type: 'string', maxLength: NOTE_MAX_CHARS } }, required: ['text'] },
  },
];

export interface NutritionDay {
  d: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  meals: number;
  logged: boolean;
}

export interface SleepNight {
  date: string;
  onset: string;
  wake: string;
  asleepMin: number;
  awakeMin: number;
  stages: { rem: number; light: number; deep: number } | 'none';
  awakenings: number;
  hrvMs: number | null;
  restBpm: number | null;
  score: number | null;
}

export interface PlanInfo {
  goal: string;
  level: string;
  week: number;
  weeks: number;
  done: number;
  planned: number;
  scalePct: number;
  next: { date: string; title: string }[];
}

/** Where the tools read: the app binds it to the phone's database and JoyoRogo (`toolData.ts`), tests to fixtures. */
export interface ToolData {
  /** Today as a local `YYYY-MM-DD`. */
  today(): string;
  /** Rows from the phone for every day in `[from, to]`; food and weight fields are null here. */
  daily(from: string, to: string): Promise<DigestDay[]>;
  /** Weigh-ins per date, or `not_connected` when signed out. */
  weights(from: string, to: string): Promise<Map<string, number> | 'not_connected'>;
  food(from: string, to: string): Promise<NutritionDay[] | 'not_connected'>;
  sleepNight(date: string): Promise<SleepNight | null>;
  workouts(from: string, to: string, sport: string | null): Promise<DigestWorkout[]>;
  workout(id: string): Promise<Record<string, unknown> | null>;
  plan(): Promise<PlanInfo | null>;
}

/** What the answer screen shows under a reply as "based on": the tool and its plain arguments. No health values. */
export interface ToolTrace {
  tool: ToolName;
  args: Record<string, string | number>;
}

/** What a tool step shows after it ran: how many rows it found, or that it found nothing or failed. No health values. */
export interface ToolSummary {
  count: number | null;
  empty: boolean;
  failed: boolean;
  /** The data is behind the JoyoRogo sign-in and the person is signed out. */
  notConnected: boolean;
}

export interface ToolOutcome {
  content: string;
  trace: ToolTrace;
  summary: ToolSummary;
  /** Set by `propose_note`: text for the confirm chip. Not stored. */
  proposedNote?: string;
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

class ToolInputError extends Error {}

/** `from` and `to` as a valid, ordered, capped range (the newest `maxDays` kept). */
function rangeArgs(args: Record<string, unknown>, maxDays: number): { from: string; to: string; clamped: boolean } {
  if (!isDate(args.from) || !isDate(args.to)) throw new ToolInputError('from and to must be dates as YYYY-MM-DD');
  let { from, to } = { from: args.from, to: args.to };
  if (from > to) [from, to] = [to, from];
  const span = daysBetween(from, to) + 1;
  if (span > maxDays) return { from: addDays(to, -(maxDays - 1)), to, clamped: true };
  return { from, to, clamped: false };
}

const dailyFieldsArg = (raw: unknown): DailyField[] => {
  if (!Array.isArray(raw) || raw.length === 0) return [...DAILY_FIELDS];
  const wanted = raw.filter((f): f is DailyField => typeof f === 'string' && (DAILY_FIELDS as readonly string[]).includes(f));
  return wanted.length > 0 ? [...new Set(wanted)] : [...DAILY_FIELDS];
};

/** Daily rows with the JoyoRogo fields filled in when asked for. Food fields only inside the last `nutritionDays`; beyond that they stay null and `notes` says so. */
async function loadRows(data: ToolData, from: string, to: string, fields: readonly DailyField[]): Promise<{ rows: DigestDay[]; notes: string[] }> {
  const rows = await data.daily(from, to);
  const notes: string[] = [];
  const byDate = new Map(rows.map((r) => [r.d, { ...r }]));
  if (fields.includes('weightKg')) {
    const weights = await data.weights(from, to);
    if (weights === 'not_connected') notes.push('weightKg: not signed in to JoyoRogo');
    else for (const [d, kg] of weights) if (byDate.has(d)) byDate.get(d)!.weightKg = kg;
  }
  const wantsFood = FOOD_FIELDS.some((f) => fields.includes(f));
  if (wantsFood) {
    const foodFrom = daysBetween(from, to) + 1 > TOOL_LIMITS.nutritionDays ? addDays(to, -(TOOL_LIMITS.nutritionDays - 1)) : from;
    if (foodFrom !== from) notes.push(`eatKcal and proteinG only cover ${foodFrom} to ${to}`);
    const food = await data.food(foodFrom, to);
    if (food === 'not_connected') notes.push('eatKcal, proteinG: not signed in to JoyoRogo');
    else {
      for (const f of food) {
        const row = byDate.get(f.d);
        if (row && f.logged) {
          row.eatKcal = f.kcal;
          row.proteinG = f.proteinG;
        }
      }
    }
  }
  return { rows: [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1)), notes };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface TrendResult {
  metric: DailyField;
  days: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  last: number | null;
  n: number;
  previous: { mean: number | null; n: number };
  deltaVsPrevious: number | null;
}

function stats(values: readonly (number | null)[]) {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return { mean: null, min: null, max: null, last: null, n: 0 };
  return { mean: round1(v.reduce((a, b) => a + b, 0) / v.length), min: round1(Math.min(...v)), max: round1(Math.max(...v)), last: round1(v[v.length - 1]!), n: v.length };
}

/** Mean, min, max and the change against the period before it. Pure; exported for tests. */
export function trendOf(metric: DailyField, days: number, current: readonly (number | null)[], previous: readonly (number | null)[]): TrendResult {
  const now = stats(current);
  const before = stats(previous);
  return {
    metric,
    days,
    ...now,
    previous: { mean: before.mean, n: before.n },
    deltaVsPrevious: now.mean !== null && before.mean !== null ? round1(now.mean - before.mean) : null,
  };
}

/** Keeps a result under the character cap: list rows are dropped from the old end (`oldestFirst` says which end that is), anything else is refused. */
function cap(value: Record<string, unknown>, listKey: string | null, oldestFirst = true): string {
  let json = JSON.stringify(value);
  if (json.length <= TOOL_LIMITS.resultChars) return json;
  const list = listKey && Array.isArray(value[listKey]) ? [...(value[listKey] as unknown[])] : null;
  if (list) {
    let dropped = 0;
    while (list.length > 1 && json.length > TOOL_LIMITS.resultChars) {
      // The newest rows are the ones people ask about: cut from the old end of the list.
      if (oldestFirst) list.shift();
      else list.pop();
      dropped += 1;
      json = JSON.stringify({ ...value, [listKey!]: list, truncatedRows: dropped });
    }
    if (json.length <= TOOL_LIMITS.resultChars) return json;
  }
  return JSON.stringify({ error: 'result too large, ask for a shorter range' });
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? flat(v, max) : '');

async function dispatch(call: ToolCall, data: ToolData): Promise<Omit<ToolOutcome, 'summary'>> {
  const a = call.args;
  switch (call.name) {
    case 'get_daily': {
      const { from, to, clamped } = rangeArgs(a, TOOL_LIMITS.maxDays);
      const fields = dailyFieldsArg(a.fields);
      const { rows, notes } = await loadRows(data, from, to, fields);
      const out = rows.slice(-TOOL_LIMITS.maxRows).map((r) => ({ d: r.d, ...Object.fromEntries(fields.map((f) => [f, r[f]])) }));
      if (clamped) notes.push(`range cut to the last ${TOOL_LIMITS.maxDays} days: ${from} to ${to}`);
      return { content: cap({ rows: out, ...(notes.length ? { notes } : {}) }, 'rows'), trace: { tool: 'get_daily', args: { from, to, fields: fields.length === DAILY_FIELDS.length ? 'all' : fields.join(',') } } };
    }
    case 'get_trend': {
      const metric = a.metric;
      if (typeof metric !== 'string' || !(DAILY_FIELDS as readonly string[]).includes(metric)) throw new ToolInputError('metric is not one of the daily fields');
      const wanted = Math.round(Number(a.days));
      if (!Number.isFinite(wanted)) throw new ToolInputError('days must be a number from 7 to 90');
      const isFood = FOOD_FIELDS.includes(metric as DailyField);
      const days = Math.min(isFood ? TOOL_LIMITS.nutritionDays / 2 : TOOL_LIMITS.maxDays, Math.max(7, wanted));
      const today = data.today();
      const currentFrom = addDays(today, -(days - 1));
      const previousTo = addDays(currentFrom, -1);
      const previousFrom = addDays(previousTo, -(days - 1));
      const field = metric as DailyField;
      const { rows, notes } = await loadRows(data, previousFrom, today, [field]);
      const pick = (from: string, to: string) => rows.filter((r) => r.d >= from && r.d <= to).map((r) => r[field]);
      const result = trendOf(field, days, pick(currentFrom, today), pick(previousFrom, previousTo));
      return { content: cap({ ...result, ...(notes.length ? { notes } : {}) }, null), trace: { tool: 'get_trend', args: { metric, days } } };
    }
    case 'get_sleep_night': {
      if (!isDate(a.date)) throw new ToolInputError('date must be YYYY-MM-DD');
      const night = await data.sleepNight(a.date);
      return { content: cap(night ? { ...night } : { date: a.date, recorded: false }, null), trace: { tool: 'get_sleep_night', args: { date: a.date } } };
    }
    case 'list_workouts': {
      const { from, to } = rangeArgs(a, TOOL_LIMITS.maxDays);
      const sport = text(a.sport, 30) || null;
      const rows = (await data.workouts(from, to, sport)).slice(0, TOOL_LIMITS.workoutRows);
      return { content: cap({ workouts: rows }, 'workouts', false), trace: { tool: 'list_workouts', args: { from, to, ...(sport ? { sport } : {}) } } };
    }
    case 'get_workout': {
      const id = text(a.id, 24);
      if (id === '') throw new ToolInputError('id is required');
      const detail = await data.workout(id);
      return { content: cap(detail ?? { id, found: false }, null), trace: { tool: 'get_workout', args: { id } } };
    }
    case 'get_nutrition': {
      const { from, to } = rangeArgs(a, TOOL_LIMITS.nutritionDays);
      const food = await data.food(from, to);
      const body = food === 'not_connected' ? { not_connected: true, hint: 'The person is not signed in to JoyoRogo, so food is unknown.' } : { days: food }; // i18n-ok: model-facing text
      return { content: cap(body, food === 'not_connected' ? null : 'days'), trace: { tool: 'get_nutrition', args: { from, to } } };
    }
    case 'get_plan': {
      const plan = await data.plan();
      return { content: cap(plan ? { ...plan } : { plan: null }, null), trace: { tool: 'get_plan', args: {} } };
    }
    case 'propose_note': {
      const note = text(a.text, NOTE_MAX_CHARS);
      if (note === '') throw new ToolInputError('text is required');
      return { content: JSON.stringify({ status: 'proposed', note: 'The person will be asked to confirm; it is not saved yet.' }), trace: { tool: 'propose_note', args: {} }, proposedNote: note }; // i18n-ok: model-facing text
    }
    default:
      throw new ToolInputError(`unknown tool ${flat(String(call.name), 40)}`);
  }
}

const LIST_KEYS = ['rows', 'workouts', 'days'] as const;

/** Reads the outcome of a tool from its own JSON result: the row count, an error, "not connected", "not found". Pure; exported for tests. */
export function summarize(content: string): ToolSummary {
  let body: unknown;
  try {
    body = JSON.parse(content);
  } catch {
    return { count: null, empty: false, failed: true, notConnected: false };
  }
  if (typeof body !== 'object' || body === null) return { count: null, empty: false, failed: true, notConnected: false };
  const record = body as Record<string, unknown>;
  if ('error' in record) return { count: null, empty: false, failed: true, notConnected: false };
  if (record.not_connected === true) return { count: null, empty: true, failed: false, notConnected: true };
  for (const key of LIST_KEYS) {
    const list = record[key];
    if (Array.isArray(list)) return { count: list.length, empty: list.length === 0, failed: false, notConnected: false };
  }
  const n = typeof record.n === 'number' ? record.n : null;
  const missing = record.recorded === false || record.found === false || record.plan === null;
  return { count: n, empty: missing || n === 0, failed: false, notConnected: false };
}

/**
 * Runs one tool call. A bad argument or a failing data source never throws: the model gets `{"error": "..."}` and can adjust,
 * and the loop stays bounded by its own round limit.
 */
export async function runTool(call: ToolCall, data: ToolData): Promise<ToolOutcome> {
  const known = (TOOL_NAMES as readonly string[]).includes(call.name);
  try {
    const outcome = await dispatch(call, data);
    return { ...outcome, summary: summarize(outcome.content) };
  } catch (error) {
    const message = error instanceof ToolInputError ? error.message : 'the data could not be read';
    return {
      content: JSON.stringify({ error: message }),
      trace: { tool: (known ? call.name : 'get_daily') as ToolName, args: {} },
      summary: { count: null, empty: false, failed: true, notConnected: false },
    };
  }
}

export const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);
