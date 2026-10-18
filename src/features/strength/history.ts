/**
 * The strength history for screens: every finished workout (newest first) and the catalog that names its exercises.
 *
 * Kept in module memory so a screen opens with the last result at once; each focus checks `strength_record` (one cheap
 * aggregate, workouts and custom exercises) and re-reads only when something changed, or after `bumpStrengthHistory()`.
 * Nobody has to call the bump: it exists for code that wants every mounted screen to refresh right now.
 */
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { buildCatalog, type Catalog } from './catalog';
import { customExerciseIndex, listStrengthWorkouts } from './store';
import type { StrengthWorkout } from './types';

export interface StrengthHistory {
  /** False until the first read finished (and nothing was cached). */
  ready: boolean;
  /** Not deleted, newest first. */
  workouts: StrengthWorkout[];
  catalog: Catalog;
  /** Reads again now. */
  reload: () => Promise<void>;
}

interface Snapshot {
  signature: string;
  workouts: StrengthWorkout[];
  catalog: Catalog;
}

let version = 0;
let cache: Snapshot | null = null;
const listeners = new Set<() => void>();

/** Drops the cached history; mounted screens read it again. */
export function bumpStrengthHistory(): void {
  version += 1;
  cache = null;
  for (const listener of listeners) listener();
}

const EMPTY_CATALOG = buildCatalog([]);

/** What changed in `strength_record` as far as history is concerned: the number, the newest edit and the sum of edit times. */
async function signatureOf(db: SQLiteDatabase): Promise<string> {
  const row = await db.getFirstAsync<{ n: number; newest: number | null; sum: number | null }>(
    `SELECT COUNT(*) AS n, MAX(updated_at) AS newest, SUM(updated_at) AS sum FROM strength_record WHERE kind IN ('workout', 'exercise')`,
  );
  return `${version}:${row?.n ?? 0}:${row?.newest ?? 0}:${row?.sum ?? 0}`;
}

async function read(db: SQLiteDatabase, force: boolean): Promise<Snapshot> {
  const signature = await signatureOf(db);
  if (!force && cache && cache.signature === signature) return cache;
  const [workouts, custom] = await Promise.all([listStrengthWorkouts(db), customExerciseIndex(db)]);
  const snapshot: Snapshot = { signature, workouts, catalog: buildCatalog([...custom.values()]) };
  cache = snapshot;
  return snapshot;
}

/** Strength history, reloaded on focus. Also used by the Workouts tab to find the workouts behind watch rows. */
export function useStrengthHistory(): StrengthHistory {
  const db = useSQLiteContext();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(cache);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await read(db, false);
      if (alive.current) setSnapshot((current) => (current === next ? current : next));
    } catch {
      // The screens keep what they have; the next focus reads again.
    }
  }, [db]);

  useEffect(() => {
    alive.current = true;
    const onBump = () => void reload();
    listeners.add(onBump);
    return () => {
      alive.current = false;
      listeners.delete(onBump);
    };
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return {
    ready: snapshot !== null,
    workouts: snapshot?.workouts ?? NO_WORKOUTS,
    catalog: snapshot?.catalog ?? EMPTY_CATALOG,
    reload,
  };
}

const NO_WORKOUTS: StrengthWorkout[] = [];
