import Storage from 'expo-sqlite/kv-store';

import type { ChatTurn } from './api';

/**
 * The conversation stays on the phone (the server stores no messages), as the last 40 turns in the kv-store. "Clear" empties it.
 * Reads never throw: a damaged value is an empty conversation.
 */
const KEY = 'joyofit.coach.chat';
const KEEP = 40;

export function readChat(): ChatTurn[] {
  try {
    const value: unknown = JSON.parse(Storage.getItemSync(KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (turn): turn is ChatTurn =>
        typeof turn === 'object' && turn !== null && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string',
    );
  } catch {
    return [];
  }
}

export function writeChat(turns: readonly ChatTurn[]): void {
  Storage.setItemSync(KEY, JSON.stringify(turns.slice(-KEEP)));
}

export function clearChat(): void {
  Storage.removeItemSync(KEY);
}
