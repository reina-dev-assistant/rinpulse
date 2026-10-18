import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { cloudLog } from '@/cloud/log';
import { errorMessage } from '@/format';

import { deleteWorkout } from './deleteWorkout';

/**
 * The 5 seconds between "Hapus" and the delete: the workout is hidden at once, the snackbar offers "Urungkan", and only when the time is
 * up (or the app leaves the screen, or another delete starts) is it really deleted. Undoing is then just forgetting the plan, so nothing
 * has to be put back. One delete waits at a time.
 */
export const UNDO_MS = 5_000;

export interface PendingDelete {
  start: number;
  label: string;
}

interface Plan extends PendingDelete {
  db: SQLiteDatabase;
  postIds: readonly string[];
  /** Called after the workout is gone, so the screens read their lists again. */
  onDeleted: () => void;
  timer: ReturnType<typeof setTimeout>;
}

let plan: Plan | null = null;
let view: PendingDelete | null = null;
const listeners = new Set<() => void>();
let watchingApp = false;

function publish(): void {
  view = plan === null ? null : { start: plan.start, label: plan.label };
  for (const listener of listeners) listener();
}

async function commit(done: Plan): Promise<void> {
  try {
    await deleteWorkout(done.db, done.start, done.postIds);
  } catch (error) {
    cloudLog(`workout ${done.start} not deleted: ${errorMessage(error)}`, 'error');
  }
  done.onDeleted();
}

/** Deletes the waiting workout now (a new delete starts, or the app goes to the background). */
export async function commitPendingDelete(): Promise<void> {
  const waiting = plan;
  if (waiting === null) return;
  clearTimeout(waiting.timer);
  plan = null;
  publish();
  await commit(waiting);
}

/** Hides the workout and starts the 5 seconds. */
export function scheduleWorkoutDelete(db: SQLiteDatabase, item: PendingDelete & { postIds: readonly string[]; onDeleted: () => void }): void {
  if (!watchingApp) {
    watchingApp = true;
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') void commitPendingDelete();
    });
  }
  void commitPendingDelete();
  const timer = setTimeout(() => void commitPendingDelete(), UNDO_MS);
  plan = { db, start: item.start, label: item.label, postIds: item.postIds, onDeleted: item.onDeleted, timer };
  publish();
}

/** "Urungkan": the workout is shown again and nothing was deleted. */
export function undoPendingDelete(): void {
  if (plan === null) return;
  clearTimeout(plan.timer);
  plan = null;
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The delete that is waiting for its 5 seconds, or null. */
export function usePendingDelete(): PendingDelete | null {
  return useSyncExternalStore(subscribe, () => view);
}
