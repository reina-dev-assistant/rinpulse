import { describe, expect, it } from 'bun:test';

import { commitOfBuild, issueTitle, pickFresh, type Item } from './testflight-feedback';

const item = (id: string, createdDate: string, comment: string | null = null): Item => ({
  id,
  kind: 'screenshot',
  createdDate,
  comment,
  email: null,
  deviceModel: null,
  osVersion: null,
  locale: null,
  connectionType: null,
  batteryPercentage: null,
  appUptimeInMilliseconds: null,
  build: null,
  tester: null,
  screenshotFiles: [],
  crashLogFile: null,
});

describe('commitOfBuild', () => {
  const runs = [
    { headSha: 'aaa', createdAt: '2026-10-19T08:48:00Z' },
    { headSha: 'bbb', createdAt: '2026-10-19T03:39:40Z' },
    { headSha: 'ccc', createdAt: '2026-10-18T14:16:40Z' },
  ];

  it('picks the run created just before the build minute', () => {
    expect(commitOfBuild('202610190340', runs)).toBe('bbb');
    expect(commitOfBuild('202610181417', runs)).toBe('ccc');
  });

  it('knows no commit for a build no run made (a local build) or a malformed number', () => {
    expect(commitOfBuild('202610170244', runs)).toBeNull();
    expect(commitOfBuild('1.0', runs)).toBeNull();
  });
});

describe('pickFresh', () => {
  const items = [item('a', '2026-10-16T00:00:00Z'), item('b', '2026-10-18T00:00:00Z'), item('c', '2026-10-19T00:00:00Z')];

  it('returns only the ids the state has not seen', () => {
    expect(pickFresh(items, { seen: ['a', 'b'] }, {}).map((i) => i.id)).toEqual(['c']);
  });

  it('first run without --since is a baseline: nothing is new', () => {
    expect(pickFresh(items, null, {})).toEqual([]);
  });

  it('first run with --since takes the items created at or after it', () => {
    expect(pickFresh(items, null, { since: '2026-10-18T00:00:00Z' }).map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('--all ignores the state', () => {
    expect(pickFresh(items, { seen: ['a', 'b', 'c'] }, { all: true })).toHaveLength(3);
  });
});

describe('issueTitle', () => {
  it('carries the submission id so Atur can be searched before filing', () => {
    expect(issueTitle('joyofit', item('XYZ', '2026-10-16T00:00:00Z', 'tidak ada tombol import?'))).toBe(
      '[TestFlight] joyofit: tidak ada tombol import? (XYZ)',
    );
  });

  it('shortens a long comment and names an empty one', () => {
    expect(issueTitle('joyofit', item('X', 'd', 'x'.repeat(100)))).toContain(`${'x'.repeat(67)}... (X)`);
    expect(issueTitle('joyofit', item('X', 'd'))).toBe('[TestFlight] joyofit: screenshot feedback (X)');
  });
});
