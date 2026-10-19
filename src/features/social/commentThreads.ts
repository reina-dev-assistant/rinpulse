import type { RogoComment, RogoCommentPage } from '@/cloud/rogo';

/** One top-level comment with the replies loaded so far. Replies are one level deep: a reply to a reply sits in the same list. */
export interface Thread {
  comment: RogoComment;
  replies: RogoComment[];
  /** Cursor of the next page of replies; null when every reply is loaded. Meaningless while `replyCount` is 0. */
  repliesCursor: number | null;
  /** The replies were read at least once, so `repliesCursor` can be trusted. */
  repliesRead: boolean;
  /** The replies are showing. */
  open: boolean;
}

export interface CommentsState {
  threads: Thread[];
  /** Cursor of the next page of top-level comments; null on the last page. */
  nextCursor: number | null;
}

export const EMPTY_COMMENTS: CommentsState = { threads: [], nextCursor: null };

/** Fills what an older JoyoRogo leaves out, so a client ahead of the server still reads top-level comments. */
export function normalizeComment(raw: RogoComment): RogoComment {
  return {
    ...raw,
    deleted: raw.deleted === true,
    parentId: raw.parentId ?? null,
    replyCount: raw.replyCount ?? 0,
    replyTo: raw.replyTo ?? null,
    attachment: raw.attachment ?? null,
  };
}

function toThread(raw: RogoComment): Thread {
  return { comment: normalizeComment(raw), replies: [], repliesCursor: null, repliesRead: false, open: false };
}

/** Appends `items` that are not in `list` yet, keeping order. */
function addNew(list: readonly RogoComment[], items: readonly RogoComment[]): RogoComment[] {
  const seen = new Set(list.map((c) => c.id));
  const fresh = items.filter((c) => !seen.has(c.id)).map(normalizeComment);
  return fresh.length === 0 ? [...list] : [...list, ...fresh];
}

export function stateFromPage(page: RogoCommentPage): CommentsState {
  return { threads: page.items.map(toThread), nextCursor: page.nextCursor };
}

/** The next page of top-level comments; a comment that is already there (one just posted) is not added twice. */
export function appendPage(state: CommentsState, page: RogoCommentPage): CommentsState {
  const known = new Set(state.threads.map((t) => t.comment.id));
  return { threads: [...state.threads, ...page.items.filter((c) => !known.has(c.id)).map(toThread)], nextCursor: page.nextCursor };
}

/** A fresh read of the first page keeps the replies the person already opened. */
export function refreshPage(state: CommentsState, page: RogoCommentPage): CommentsState {
  const byId = new Map(state.threads.map((t) => [t.comment.id, t]));
  return {
    threads: page.items.map((raw) => {
      const comment = normalizeComment(raw);
      const old = byId.get(comment.id);
      return old ? { ...old, comment } : toThread(raw);
    }),
    nextCursor: page.nextCursor,
  };
}

function mapThread(state: CommentsState, id: string, change: (thread: Thread) => Thread): CommentsState {
  return { ...state, threads: state.threads.map((t) => (t.comment.id === id ? change(t) : t)) };
}

/** A page of replies under `parentId`; opens the thread. */
export function addReplyPage(state: CommentsState, parentId: string, page: RogoCommentPage): CommentsState {
  return mapThread(state, parentId, (t) => ({
    ...t,
    replies: addNew(t.replies, page.items),
    repliesCursor: page.nextCursor,
    repliesRead: true,
    open: true,
  }));
}

export function toggleReplies(state: CommentsState, parentId: string, open: boolean): CommentsState {
  return mapThread(state, parentId, (t) => ({ ...t, open }));
}

/** The comment the server just stored: a top-level one goes last, a reply goes under its thread, which opens. */
export function addCreated(state: CommentsState, created: RogoComment): CommentsState {
  const comment = normalizeComment(created);
  if (comment.parentId === null) {
    return state.threads.some((t) => t.comment.id === comment.id) ? state : { ...state, threads: [...state.threads, toThread(comment)] };
  }
  return mapThread(state, comment.parentId, (t) => {
    if (t.replies.some((r) => r.id === comment.id)) return t;
    return {
      ...t,
      comment: { ...t.comment, replyCount: t.comment.replyCount + 1 },
      replies: [...t.replies, comment],
      open: true,
    };
  });
}

/** After `deleteComment`: `removed` drops the comment, `hidden` keeps it as a tombstone because replies hang under it. */
export function applyDeleted(state: CommentsState, id: string, mode: 'removed' | 'hidden'): CommentsState {
  if (state.threads.some((t) => t.comment.id === id)) {
    if (mode === 'hidden') {
      return mapThread(state, id, (t) => ({ ...t, comment: { ...t.comment, deleted: true, body: '', attachment: null } }));
    }
    return { ...state, threads: state.threads.filter((t) => t.comment.id !== id) };
  }
  return {
    ...state,
    threads: state.threads.map((t) => {
      if (!t.replies.some((r) => r.id === id)) return t;
      if (mode === 'hidden') {
        return { ...t, replies: t.replies.map((r) => (r.id === id ? { ...r, deleted: true, body: '', attachment: null } : r)) };
      }
      return { ...t, replies: t.replies.filter((r) => r.id !== id), comment: { ...t.comment, replyCount: Math.max(0, t.comment.replyCount - 1) } };
    }),
  };
}

/** Who a reply is sent to. `commentId` goes out as `parentId`: JoyoRogo files a reply to a reply under its top-level comment. */
export interface ReplyTarget {
  commentId: string;
  name: string;
  handle: string | null;
}
