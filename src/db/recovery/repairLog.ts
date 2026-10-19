import Storage from 'expo-sqlite/kv-store';

import { pushLog } from '@/state/logStore';

/**
 * The log of the database repair, kept where a person can read it when nothing can be attached to the phone: the app's own log
 * screen (Settings > Advanced > Log, as errors), the console (logcat tag ReactNativeJS), and the key-value store, whose last
 * lines the failed-repair notice shows. A line that cannot be stored is dropped; logging never stops the repair.
 */

const KEY = 'dbRecovery.log';
const MAX_LINES = 120;

function read(): string[] {
  try {
    const raw = Storage.getItemSync(KEY);
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string') : [];
  } catch {
    return [];
  }
}

/** One line of the repair, with the time. */
export function recordRepairLine(message: string): void {
  const line = `${new Date().toISOString().slice(11, 23)} ${message}`;
  console.warn(`[JoyoFit db repair] ${line}`);
  try {
    pushLog({ ts: Date.now(), direction: 'error', serviceId: null, commandId: null, hex: null, message: `db repair: ${message}` });
  } catch {
    // The in-app log is a convenience.
  }
  try {
    Storage.setItemSync(KEY, JSON.stringify([...read(), line].slice(-MAX_LINES)));
  } catch {
    // The line stays in the console only.
  }
}

/** The last lines of the repair log, oldest first. */
export function repairLogLines(count: number): string[] {
  return read().slice(-count);
}

/** Starts a new log: called when a repair begins, so the lines belong to one run. */
export function startRepairLog(): void {
  try {
    Storage.removeItemSync(KEY);
  } catch {
    // The old lines stay, newest last.
  }
}
