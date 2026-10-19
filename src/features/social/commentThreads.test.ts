import { describe, expect, test } from 'bun:test';

import type { RogoComment } from '@/cloud/rogo';
import { addCreated, addReplyPage, appendPage, applyDeleted, normalizeComment, refreshPage, stateFromPage, toggleReplies } from './commentThreads';

const author = { id: 'u1', name: 'Ana', handle: 'ana', image: null };

function comment(id: string, over: Partial<RogoComment> = {}): RogoComment {
  return {
    id,
    body: `body ${id}`,
    createdAt: '2026-01-01T00:00:00Z',
    author,
    deleted: false,
    parentId: null,
    replyCount: 0,
    replyTo: null,
    attachment: null,
    ...over,
  };
}

const page = (ids: string[], nextCursor: number | null = null, over: Partial<RogoComment> = {}) => ({
  items: ids.map((id) => comment(id, over)),
  nextCursor,
});

describe('normalizeComment', () => {
  test('an older server that sends none of the new fields reads as a plain top-level comment', () => {
    const old = { id: 'c', body: 'hi', createdAt: '2026-01-01T00:00:00Z', author } as unknown as RogoComment;
    expect(normalizeComment(old)).toMatchObject({ deleted: false, parentId: null, replyCount: 0, replyTo: null, attachment: null });
  });
});

describe('pages', () => {
  test('the next page is added once even when a comment of it was posted meanwhile', () => {
    const first = stateFromPage(page(['a', 'b'], 20));
    const next = appendPage(first, page(['b', 'c'], null));
    expect(next.threads.map((t) => t.comment.id)).toEqual(['a', 'b', 'c']);
    expect(next.nextCursor).toBeNull();
  });

  test('a refresh keeps the replies that were opened and updates the count', () => {
    let state = stateFromPage(page(['a'], null, { replyCount: 1 }));
    state = addReplyPage(state, 'a', page(['r1'], null, { parentId: 'a' }));
    const fresh = refreshPage(state, { items: [comment('a', { replyCount: 2 }), comment('z')], nextCursor: null });
    expect(fresh.threads.map((t) => t.comment.id)).toEqual(['a', 'z']);
    expect(fresh.threads[0]!.replies.map((r) => r.id)).toEqual(['r1']);
    expect(fresh.threads[0]!.open).toBe(true);
    expect(fresh.threads[0]!.comment.replyCount).toBe(2);
  });
});

describe('replies', () => {
  test('a reply page opens the thread and pages without duplicates', () => {
    let state = stateFromPage(page(['a'], null, { replyCount: 3 }));
    state = addReplyPage(state, 'a', page(['r1', 'r2'], 2, { parentId: 'a' }));
    expect(state.threads[0]!.repliesCursor).toBe(2);
    state = addReplyPage(state, 'a', page(['r2', 'r3'], null, { parentId: 'a' }));
    const thread = state.threads[0]!;
    expect(thread.replies.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(thread.repliesCursor).toBeNull();
    expect(thread.open).toBe(true);
  });

  test('toggleReplies hides and shows without losing what was loaded', () => {
    let state = addReplyPage(stateFromPage(page(['a'], null, { replyCount: 1 })), 'a', page(['r1'], null, { parentId: 'a' }));
    state = toggleReplies(state, 'a', false);
    expect(state.threads[0]!.open).toBe(false);
    expect(state.threads[0]!.replies).toHaveLength(1);
  });

  test('a new reply lands under its thread, bumps the count and opens it; a new comment goes last', () => {
    let state = stateFromPage(page(['a', 'b']));
    state = addCreated(state, comment('r1', { parentId: 'a', replyTo: { id: 'x', name: 'Budi', handle: 'budi' } }));
    expect(state.threads[0]!.replies.map((r) => r.id)).toEqual(['r1']);
    expect(state.threads[0]!.comment.replyCount).toBe(1);
    expect(state.threads[0]!.open).toBe(true);
    expect(state.threads[1]!.replies).toEqual([]);
    state = addCreated(state, comment('c'));
    expect(state.threads.map((t) => t.comment.id)).toEqual(['a', 'b', 'c']);
  });

  test('the same reply added twice (a double tap, a refresh) counts once', () => {
    let state = stateFromPage(page(['a']));
    state = addCreated(state, comment('r1', { parentId: 'a' }));
    state = addCreated(state, comment('r1', { parentId: 'a' }));
    expect(state.threads[0]!.replies).toHaveLength(1);
    expect(state.threads[0]!.comment.replyCount).toBe(1);
  });

  test('a reply to a thread that is not on screen leaves the state alone', () => {
    const state = stateFromPage(page(['a']));
    expect(addCreated(state, comment('r1', { parentId: 'gone' })).threads).toEqual(state.threads);
  });
});

describe('deleting', () => {
  test('a top-level comment without replies is removed', () => {
    const state = applyDeleted(stateFromPage(page(['a', 'b'])), 'a', 'removed');
    expect(state.threads.map((t) => t.comment.id)).toEqual(['b']);
  });

  test('a parent with replies becomes a tombstone and keeps its replies', () => {
    let state = addReplyPage(stateFromPage(page(['a'], null, { replyCount: 1, attachment: { kind: 'image' } as never })), 'a', page(['r1'], null, { parentId: 'a' }));
    state = applyDeleted(state, 'a', 'hidden');
    const thread = state.threads[0]!;
    expect(thread.comment).toMatchObject({ deleted: true, body: '', attachment: null });
    expect(thread.replies).toHaveLength(1);
  });

  test('a removed reply drops the count; the count never goes below zero', () => {
    let state = addReplyPage(stateFromPage(page(['a'], null, { replyCount: 1 })), 'a', page(['r1'], null, { parentId: 'a' }));
    state = applyDeleted(state, 'r1', 'removed');
    expect(state.threads[0]!.replies).toEqual([]);
    expect(state.threads[0]!.comment.replyCount).toBe(0);
    expect(applyDeleted(state, 'r1', 'removed').threads[0]!.comment.replyCount).toBe(0);
  });
});
