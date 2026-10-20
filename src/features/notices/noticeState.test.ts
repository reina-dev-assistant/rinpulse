import { describe, expect, it } from 'bun:test';

import { isNoticeExpanded, parseExpandedNotices, withNoticeExpanded } from './noticeState';

describe('expanded notices', () => {
  it('starts collapsed', () => {
    expect(parseExpandedNotices(null)).toEqual([]);
    expect(isNoticeExpanded([], 'sleep.noStages')).toBe(false);
  });

  it('remembers each notice on its own', () => {
    const open = withNoticeExpanded([], 'sleep.noStages', true);
    expect(isNoticeExpanded(open, 'sleep.noStages')).toBe(true);
    expect(isNoticeExpanded(open, 'other')).toBe(false);
    expect(withNoticeExpanded(open, 'sleep.noStages', false)).toEqual([]);
  });

  it('returns the same array when nothing changes', () => {
    const open = withNoticeExpanded([], 'a', true);
    expect(withNoticeExpanded(open, 'a', true)).toBe(open);
    expect(withNoticeExpanded(open, 'b', false)).toBe(open);
  });

  it('survives a round trip and ignores damaged text', () => {
    const open = withNoticeExpanded(withNoticeExpanded([], 'a', true), 'b', true);
    expect(parseExpandedNotices(JSON.stringify(open))).toEqual(['a', 'b']);
    for (const raw of ['', '{', '{"a":true}', '"a"', '3']) expect(parseExpandedNotices(raw)).toEqual([]);
    expect(parseExpandedNotices('["a", 4, "", "a", null]')).toEqual(['a']);
  });
});
