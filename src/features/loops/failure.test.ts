import { afterAll, describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';
import { RequestError } from '@/features/routes/map/http';

import { failureMessage } from './failure';
import { LoopError, type LoopCandidate } from './generate';

const closest = (lengthError: number): LoopCandidate => ({
  id: '1',
  line: [],
  lengthM: 5000 * (1 + lengthError),
  newShare: null,
  repeatShare: 0,
  lengthError,
});

afterAll(() => applyLocale('id'));

describe('failureMessage (Indonesian)', () => {
  test('a busy service is named, with nothing to offer', () => {
    const text = failureMessage(new LoopError('busy', new RequestError('http', 'HTTP 429', 429)), 5000);
    expect(text.message).toContain('Layanan peta sedang sibuk');
    expect(text.closest).toBeNull();
  });

  test('no loop of the length says so with the target, and no closest when there is none', () => {
    const text = failureMessage(new LoopError('no_loop'), 5000);
    expect(text.message).toContain('loop 5,0 km');
    expect(text.closest).toBeNull();
  });

  test('the closest loop is named with its length and how far off it is', () => {
    const long = closest(0.46);
    const over = failureMessage(new LoopError('no_loop', undefined, long), 5000);
    expect(over.message).toContain('7,3 km');
    expect(over.message).toContain('lebih 46%');
    expect(over.closest).toBe(long);
    const under = failureMessage(new LoopError('no_loop', undefined, closest(-0.3)), 5000);
    expect(under.message).toContain('3,5 km');
    expect(under.message).toContain('kurang 30%');
  });

  test('no street and no network keep their own words; an unknown error reads as the network', () => {
    expect(failureMessage(new LoopError('no_road'), 5000).message).toContain('Tidak ada jalan');
    expect(failureMessage(new LoopError('network'), 5000).message).toContain('tidak bisa dijangkau');
    expect(failureMessage(new Error('x'), 5000).message).toContain('tidak bisa dijangkau');
  });
});

describe('failureMessage (English)', () => {
  test('says why: service busy, or no loop of the length with the closest one', () => {
    applyLocale('en');
    expect(failureMessage(new LoopError('busy'), 5000).message).toContain('map service is busy');
    const text = failureMessage(new LoopError('no_loop', undefined, closest(0.46)), 5000);
    expect(text.message).toContain('No loop of 5.0 km');
    expect(text.message).toContain('7.3 km, 46% over');
  });
});
