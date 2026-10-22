import { flat, MAX_NOTES, NOTE_MAX_CHARS } from './digest';
import { readJson, type KvStore } from './kv';

const KEY = 'joyofit.ai.notes';

export interface CoachNote {
  id: string;
  text: string;
}

const valid = (v: unknown): v is CoachNote[] => Array.isArray(v) && v.every((n) => typeof n === 'object' && n !== null && typeof (n as CoachNote).id === 'string' && typeof (n as CoachNote).text === 'string');

export type NoteResult = { ok: true; notes: CoachNote[] } | { ok: false; reason: 'empty' | 'full' | 'missing' };

/**
 * "Catatan coach": notes the person keeps for the AI (an injury, a goal, a preference), at most 20 of 200 characters, stored on
 * the phone only and sent with every request. They are data for the model, never instructions: they are flattened and capped here
 * and quoted by the digest. Nothing is added without the person's tap (`propose_note` only suggests).
 */
export function createNotesStore(kv: KvStore, newId: () => string = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  const read = (): CoachNote[] =>
    readJson<CoachNote[]>(kv, KEY, [], valid)
      .map((n) => ({ id: flat(n.id, 12), text: flat(n.text, NOTE_MAX_CHARS) }))
      .filter((n) => n.text !== '')
      .slice(0, MAX_NOTES);
  const write = (notes: CoachNote[]): CoachNote[] => {
    kv.setItem(KEY, JSON.stringify(notes));
    return notes;
  };
  return {
    list: read,
    add(text: string): NoteResult {
      const clean = flat(text, NOTE_MAX_CHARS);
      if (clean === '') return { ok: false, reason: 'empty' };
      const notes = read();
      if (notes.length >= MAX_NOTES) return { ok: false, reason: 'full' };
      if (notes.some((n) => n.text.toLowerCase() === clean.toLowerCase())) return { ok: true, notes };
      return { ok: true, notes: write([...notes, { id: newId().slice(0, 12), text: clean }]) };
    },
    update(id: string, text: string): NoteResult {
      const clean = flat(text, NOTE_MAX_CHARS);
      if (clean === '') return { ok: false, reason: 'empty' };
      const notes = read();
      if (!notes.some((n) => n.id === id)) return { ok: false, reason: 'missing' };
      return { ok: true, notes: write(notes.map((n) => (n.id === id ? { ...n, text: clean } : n))) };
    },
    remove: (id: string): CoachNote[] => write(read().filter((n) => n.id !== id)),
    clear: (): void => kv.removeItem(KEY),
  };
}
export type NotesStore = ReturnType<typeof createNotesStore>;
