// Fixtures shared by the Joyo AI tests (named *Fixtures so the UI text scan skips it). No bun:test import: this file is type-checked with the app.
import { addDays } from '@/features/coach/time';
import type { DigestDay, DigestSource } from './digest';
import { EMPTY_PERSON, type Person } from './person';
import type { NutritionDay, PlanInfo, SleepNight, ToolData } from './tools';
import type { Adapter, ModelReply, ModelRequest, ProviderConnection } from './types';

export const TODAY = '2026-10-22';

export const adult: Person = { ...EMPTY_PERSON, ageYears: 34, sex: 'm', heightCm: 172, goal: 'lose', weightGoalKg: 80, weightGoalDate: '2027-02-01', eatKcal: 1900 };

export function day(d: string, over: Partial<DigestDay> = {}): DigestDay {
  return { d, sleepMin: 420, sleepScore: 78, restBpm: 58, hrvMs: 41, strain: 9.4, steps: 7421, activeKcal: 512, exerciseMin: 38, weightKg: 81.2, eatKcal: 1850, proteinG: 92, ...over };
}

export function fourteenDays(over: (i: number) => Partial<DigestDay> = () => ({})): DigestDay[] {
  return Array.from({ length: 14 }, (_, i) => day(addDays(TODAY, i - 13), over(i)));
}

export function sampleSource(over: Partial<DigestSource> = {}): DigestSource {
  return {
    now: `${TODAY}T07:41+07:00`,
    locale: 'id',
    person: adult,
    goals: { stepsPerDay: 8000, stepsIsDefault: true, sleepNeedMin: 450 },
    state: {
      readiness: { word: 'Strained' },
      load: { status: 'productive', ratio: 1.12 },
      hrv: { state: 'low', recentMs: 38, baselineMs: 47 },
      sleepDebtMin: 95,
      strainAvg7: 9.8,
      vo2max: 41,
      recoveryHoursLeft: 6,
    },
    days: fourteenDays(),
    workouts: Array.from({ length: 10 }, (_, i) => ({ id: `w:${1_729_500_000 + i}`, d: addDays(TODAY, -i), sport: 'Outdoor run', min: 42, km: 6.1, avgBpm: 152, plan: i % 2 === 0 ? 'Lari tempo' : null })),
    plan: { goal: 'run10k', level: 'beginner', week: 4, weeks: 12, done: 2, planned: 3, scalePct: 85 },
    notes: [{ id: 'n3', text: 'Lutut kiri sering nyeri kalau turun tangga' }],
    coverage: { watchDays: 12, foodDays: 9, weighIns: 2, missing: [] },
    ...over,
  };
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers from a queue and records what was sent. */
export function mockFetch(answers: (Response | Error | ((call: FetchCall) => Response))[]): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const queue = [...answers];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const next = queue.shift();
    if (next === undefined) throw new Error('no answer queued');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call) : next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** An adapter that answers from a queue of replies (or errors) and records the requests. */
export function scriptedAdapter(script: (ModelReply | Error)[]): Adapter & { requests: ModelRequest[]; conns: ProviderConnection[] } {
  const queue = [...script];
  const requests: ModelRequest[] = [];
  const conns: ProviderConnection[] = [];
  return {
    requests,
    conns,
    async complete(conn, request) {
      conns.push(conn);
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error('script exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
    async listModels() {
      return [];
    },
  };
}

export const textReply = (text: string): ModelReply => ({ text, thinking: '', toolCalls: [], usage: { inputTokens: 1000, outputTokens: 80 }, stop: 'end', finish: 'stop' });
export const toolReply = (...calls: { id: string; name: string; args: Record<string, unknown> }[]): ModelReply => ({ text: '', thinking: '', toolCalls: calls, usage: { inputTokens: 900, outputTokens: 30 }, stop: 'tools', finish: 'tool_calls' });

export function fakeToolData(over: Partial<ToolData> = {}): ToolData & { calls: string[] } {
  const calls: string[] = [];
  const base: ToolData = {
    today: () => TODAY,
    async daily(from, to) {
      calls.push(`daily ${from} ${to}`);
      const rows: DigestDay[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) rows.push(day(d, { weightKg: null, eatKcal: null, proteinG: null, hrvMs: d <= addDays(TODAY, -14) ? 50 : 40 }));
      return rows;
    },
    async weights(from, to) {
      calls.push(`weights ${from} ${to}`);
      return new Map([[to, 81.5]]);
    },
    async food(from, to): Promise<NutritionDay[]> {
      calls.push(`food ${from} ${to}`);
      const out: NutritionDay[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) out.push({ d, kcal: 1800, proteinG: 90, carbsG: 200, fatG: 60, meals: 3, logged: true });
      return out;
    },
    async sleepNight(date): Promise<SleepNight | null> {
      calls.push(`sleep ${date}`);
      return { date, onset: '23:10', wake: '06:20', asleepMin: 402, awakeMin: 28, stages: 'none', awakenings: 2, hrvMs: 41, restBpm: 58, score: 71 };
    },
    async workouts(from, to, sport) {
      calls.push(`workouts ${from} ${to} ${sport ?? ''}`);
      return [{ id: 'w:1', d: to, sport: 'Outdoor run', min: 42, km: 6.1, avgBpm: 152, plan: null }];
    },
    async workout(id) {
      calls.push(`workout ${id}`);
      return id === 'w:1' ? { id, sport: 'Outdoor run', min: 42, zoneMinutes: [3, 20, 15, 4, 0] } : null;
    },
    async plan(): Promise<PlanInfo | null> {
      calls.push('plan');
      return { goal: 'run10k', level: 'beginner', week: 4, weeks: 12, done: 2, planned: 3, scalePct: 85, next: [{ date: '2026-10-23', title: 'Lari santai' }] };
    },
  };
  return Object.assign({ ...base, ...over }, { calls });
}
