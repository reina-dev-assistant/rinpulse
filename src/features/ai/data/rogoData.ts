import { NotSignedInError } from '@/cloud/api';
import { authClient } from '@/cloud/auth';
import { rogo } from '@/cloud/rogo';
import { addDays } from '@/features/coach/time';
import type { NutritionDay } from '../tools';

const CACHE_MS = 2 * 60_000;

/**
 * The JoyoRogo reads the tools use: `food/listByDate` per day and `weight/history`, the same calls Meals on the watch already makes.
 * Nothing is written. Answers are kept for two minutes so a tool loop that asks twice does not call twice. When the person is signed
 * out (no session cookie) the answer is `not_connected`, never a guess.
 */
const sharedFood = new Map<string, { at: number; day: NutritionDay }>();
let sharedWeights: { at: number; map: Map<string, number> } | null = null;

let owner: string | null = null;

/** Forget what was read from JoyoRogo (a different session, delete everything). */
export function clearRogoCache(): void {
  sharedFood.clear();
  sharedWeights = null;
  owner = null;
}

/** The cache belongs to one session: another account (or none) never sees the diary of the one before. */
async function sameSession(): Promise<void> {
  const cookie = (await authClient.getCookie()) ?? null;
  if (cookie !== owner) {
    clearRogoCache();
    owner = cookie;
  }
}

export function createRogoData(now: () => number = Date.now) {
  // Kept for the whole app session, not per question: the second question of a chat does not read the diary again.
  const foodCache = sharedFood;

  const foodDay = async (d: string): Promise<NutritionDay> => {
    const hit = foodCache.get(d);
    if (hit && now() - hit.at < CACHE_MS) return hit.day;
    const { items, totals } = await rogo.foodDay(d);
    const day: NutritionDay = {
      d,
      kcal: Math.round(totals.kcal),
      proteinG: Math.round(totals.protein),
      carbsG: Math.round(totals.carbs),
      fatG: Math.round(totals.fat),
      meals: new Set(items.map((i) => i.meal)).size,
      logged: items.length > 0,
    };
    foodCache.set(d, { at: now(), day });
    return day;
  };

  return {
    async food(from: string, to: string): Promise<NutritionDay[] | 'not_connected'> {
      await sameSession();
      const dates: string[] = [];
      for (let d = from; d <= to && dates.length < 14; d = addDays(d, 1)) dates.push(d);
      const out: NutritionDay[] = [];
      try {
        // All days at once: the diary answers per day, and waiting for them one batch after another is what made a question start slowly.
        out.push(...(await Promise.all(dates.map(foodDay))));
      } catch (error) {
        if (error instanceof NotSignedInError) return 'not_connected';
        throw error;
      }
      return out;
    },
    async weights(from: string, to: string): Promise<Map<string, number> | 'not_connected'> {
      await sameSession();
      try {
        if (!sharedWeights || now() - sharedWeights.at >= CACHE_MS) {
          const { entries } = await rogo.weightHistory(120);
          sharedWeights = { at: now(), map: new Map(entries.map((e) => [e.date, e.weightKg])) };
        }
      } catch (error) {
        if (error instanceof NotSignedInError) return 'not_connected';
        throw error;
      }
      return new Map([...sharedWeights.map].filter(([d]) => d >= from && d <= to));
    },
  };
}
