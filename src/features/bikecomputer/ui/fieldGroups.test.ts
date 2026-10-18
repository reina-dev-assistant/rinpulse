import { describe, expect, test } from 'bun:test';

import { FIELD_IDS } from '../types';
import { FIELD_GROUPS } from './fieldGroups';

describe('FIELD_GROUPS', () => {
  test('every field is in exactly one group', () => {
    const listed = FIELD_GROUPS.flatMap((g) => g.fields);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...FIELD_IDS].sort());
  });

  test('no group is empty and the keys are unique', () => {
    for (const group of FIELD_GROUPS) expect(group.fields.length).toBeGreaterThan(0);
    expect(new Set(FIELD_GROUPS.map((g) => g.key)).size).toBe(FIELD_GROUPS.length);
  });
});
