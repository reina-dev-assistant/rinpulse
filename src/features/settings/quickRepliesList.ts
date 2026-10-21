/** The quick replies list the watch shows under a notification's reply button: defaults, limits and validation. No native imports, so it is unit-testable. */

export interface QuickReplyLimits {
  /** How many replies the watch holds. */
  slots: number;
  /** The longest reply in characters. */
  maxLength: number;
}

/** What the native module reports on Android (`QuickRepliesPacket`); used while no watch has answered. */
export const FALLBACK_LIMITS: QuickReplyLimits = { slots: 10, maxLength: 30 };

const DEFAULTS: Record<'id' | 'en', readonly string[]> = {
  id: ['Otw', 'Nanti kukabari', 'Lagi nyetir', 'Oke', 'Siap', 'Bentar ya'],
  en: ['On my way', "I'll let you know", 'Driving', 'OK', 'Got it', 'One sec'],
};

export function defaultReplies(locale: string): string[] {
  return [...(locale === 'en' ? DEFAULTS.en : DEFAULTS.id)];
}

export type ReplyProblem = 'empty' | 'tooLong' | 'multiline';
export type ListProblem = 'none' | 'tooMany';

export interface ReplyValidation {
  /** One entry per reply, null when fine. */
  items: (ReplyProblem | null)[];
  /** `none`: no reply at all (the watch refuses an empty list); `tooMany`: more than `slots`. */
  list: ListProblem | null;
  ok: boolean;
}

/** Characters as a person counts them (an emoji is one), like the native check. */
export function replyLength(text: string): number {
  return [...text].length;
}

export function validateReplies(replies: readonly string[], limits: QuickReplyLimits): ReplyValidation {
  const items = replies.map((reply): ReplyProblem | null => {
    if (/[\r\n]/.test(reply)) return 'multiline';
    if (reply.trim().length === 0) return 'empty';
    if (replyLength(reply.trim()) > limits.maxLength) return 'tooLong';
    return null;
  });
  const list: ListProblem | null = replies.length === 0 ? 'none' : replies.length > limits.slots ? 'tooMany' : null;
  return { items, list, ok: list === null && items.every((p) => p === null) };
}

/** What is stored and sent: every reply trimmed. */
export function normalizeReplies(replies: readonly string[]): string[] {
  return replies.map((reply) => reply.trim());
}

export function moveReply<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function removeReply<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

/** A list pulled from the account or read from storage: an array of strings, or an error. */
export function parseReplies(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string')) throw new Error('not a list of strings');
  return value;
}

export function sameReplies(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
