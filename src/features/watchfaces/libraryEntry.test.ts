import { describe, expect, it } from 'bun:test';

import { libraryEntry } from './watchfaceModel';

describe('libraryEntry', () => {
  it('lets Android with the package parser import into the library', () => {
    expect(libraryEntry('android', true)).toBe('import');
  });

  it('asks an older Android binary to update', () => {
    expect(libraryEntry('android', false)).toBe('update');
  });

  it('gives iPhone a direct install from file whatever the parser says (it rejects with ERR_UNSUPPORTED)', () => {
    expect(libraryEntry('ios', false)).toBe('install');
    expect(libraryEntry('ios', true)).toBe('install');
  });
});
