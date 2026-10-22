import { localDay } from '@/features/coach/time';
import { readJson, type KvStore } from './kv';
import type { Usage } from './types';

const KEY = 'joyofit.ai.usage';

export interface DayUsage {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

const valid = (v: unknown): v is DayUsage =>
  typeof v === 'object' && v !== null && typeof (v as DayUsage).day === 'string' && typeof (v as DayUsage).calls === 'number' && typeof (v as DayUsage).inputTokens === 'number' && typeof (v as DayUsage).outputTokens === 'number';

/** The calls and tokens spent today with the person's key, counted on the phone only (the provider's `usage` field, not an estimate of money). */
export function createUsageStore(kv: KvStore) {
  const read = (nowSec: number): DayUsage => {
    const day = localDay(nowSec);
    const stored = readJson<DayUsage>(kv, KEY, { day, calls: 0, inputTokens: 0, outputTokens: 0 }, valid);
    return stored.day === day ? stored : { day, calls: 0, inputTokens: 0, outputTokens: 0 };
  };
  return {
    today: read,
    /** Counts one provider call, with its tokens when the provider reported them. */
    record(nowSec: number, usage: Usage | null): DayUsage {
      const now = read(nowSec);
      const next = { ...now, calls: now.calls + 1, inputTokens: now.inputTokens + (usage?.inputTokens ?? 0), outputTokens: now.outputTokens + (usage?.outputTokens ?? 0) };
      kv.setItem(KEY, JSON.stringify(next));
      return next;
    },
    clear: () => kv.removeItem(KEY),
  };
}
export type UsageStore = ReturnType<typeof createUsageStore>;
