import { describe, expect, test } from 'bun:test';

import { FIELD_IDS, MAX_PAGES, type BikeLayout, type FieldsPage } from '../types';
import { addPage, defaultLayout, movePage, normalizeLayout, removePage, setGrid, setSlot } from './layout';

const fieldsPage = (layout: BikeLayout, id: string): FieldsPage => {
  const page = layout.pages.find((p) => p.id === id);
  if (!page || page.kind !== 'fields') throw new Error(`no fields page ${id}`);
  return page;
};

describe('defaultLayout', () => {
  test('has the climb page only with a route', () => {
    expect(defaultLayout(false).pages.map((p) => p.kind)).toEqual(['fields', 'fields', 'map', 'laps']);
    expect(defaultLayout(true).pages.map((p) => p.kind)).toEqual(['fields', 'fields', 'map', 'climb', 'laps']);
  });

  test('every page has a unique id and each grid its exact number of fields', () => {
    for (const hasRoute of [false, true]) {
      const layout = defaultLayout(hasRoute);
      expect(new Set(layout.pages.map((p) => p.id)).size).toBe(layout.pages.length);
      for (const p of layout.pages) if (p.kind === 'fields') expect(p.fields.length).toBe(p.grid);
    }
  });
});

describe('normalizeLayout', () => {
  test('a good layout survives unchanged', () => {
    const layout = defaultLayout(true);
    expect(normalizeLayout(JSON.parse(JSON.stringify(layout)), true)).toEqual(layout);
  });

  test('garbage gives the default', () => {
    for (const raw of [null, undefined, 3, 'x', {}, { pages: 'no' }, { pages: [] }, { pages: [{ kind: 'nope' }] }]) {
      expect(normalizeLayout(raw, false)).toEqual(defaultLayout(false));
    }
  });

  test('unknown fields are dropped and the slots refilled without duplicates', () => {
    const out = normalizeLayout({ pages: [{ id: 'a', kind: 'fields', grid: 4, fields: ['speed', 'warp', 7, 'speed', 'hr'] }] }, false);
    const page = fieldsPage(out, 'a');
    expect(page.fields.length).toBe(4);
    expect(page.fields.every((f) => (FIELD_IDS as readonly string[]).includes(f))).toBe(true);
    expect(page.fields.slice(0, 3)).toEqual(['speed', 'speed', 'hr']);
  });

  test('a grid size that does not exist drops the page; too many fields are cut', () => {
    const out = normalizeLayout(
      {
        pages: [
          { id: 'a', kind: 'fields', grid: 3, fields: ['speed'] },
          { id: 'b', kind: 'fields', grid: 2, fields: ['speed', 'hr', 'power', 'cadence'] },
        ],
      },
      false,
    );
    expect(out.pages.map((p) => p.id)).toEqual(['b']);
    expect(fieldsPage(out, 'b').fields).toEqual(['speed', 'hr']);
  });

  test('duplicate ids are renamed, special pages appear once, and the page count is capped', () => {
    const many = Array.from({ length: 20 }, () => ({ id: 'same', kind: 'fields', grid: 1, fields: ['speed'] }));
    const out = normalizeLayout({ pages: [...many, { kind: 'map' }, { kind: 'map' }] }, false);
    expect(out.pages.length).toBe(MAX_PAGES);
    expect(new Set(out.pages.map((p) => p.id)).size).toBe(MAX_PAGES);
    const twoMaps = normalizeLayout({ pages: [{ kind: 'map' }, { kind: 'map' }, { kind: 'laps' }] }, false);
    expect(twoMaps.pages.map((p) => p.kind)).toEqual(['map', 'laps']);
  });
});

describe('edits', () => {
  test('setSlot replaces one field and ignores bad input', () => {
    const base = defaultLayout(false);
    const next = setSlot(base, 'p1', 1, 'power3s');
    expect(fieldsPage(next, 'p1').fields[1]).toBe('power3s');
    expect(fieldsPage(base, 'p1').fields[1]).toBe('speed');
    expect(setSlot(base, 'p1', 6, 'power3s')).toEqual(base);
    expect(setSlot(base, 'p1', -1, 'power3s')).toEqual(base);
    expect(setSlot(base, 'p3', 0, 'power3s')).toEqual(base);
    expect(setSlot(base, 'p1', 0, 'warp' as never)).toEqual(base);
  });

  test('setGrid grows with fillers and shrinks by cutting', () => {
    const base = defaultLayout(false);
    const grown = fieldsPage(setGrid(base, 'p2', 8), 'p2');
    expect(grown.fields.length).toBe(8);
    expect(grown.fields.slice(0, 4)).toEqual(['avgSpeed', 'maxSpeed', 'ascent', 'grade']);
    expect(new Set(grown.fields).size).toBe(8);
    expect(fieldsPage(setGrid(base, 'p1', 1), 'p1').fields).toEqual(['movingTime']);
  });

  test('addPage: fields pages freely, special pages once, capped', () => {
    let layout = defaultLayout(false);
    expect(addPage(layout, 'map')).toEqual(layout);
    const withClimb = addPage(layout, 'climb');
    expect(withClimb.pages.at(-1)?.kind).toBe('climb');
    expect(addPage(withClimb, 'climb')).toEqual(withClimb);
    while (layout.pages.length < MAX_PAGES) layout = addPage(layout, 'fields');
    expect(addPage(layout, 'fields')).toEqual(layout);
    expect(new Set(layout.pages.map((p) => p.id)).size).toBe(MAX_PAGES);
  });

  test('removePage keeps at least one page; movePage swaps neighbours and stops at the ends', () => {
    const base = defaultLayout(false);
    expect(removePage(base, 'p2').pages.map((p) => p.id)).toEqual(['p1', 'p3', 'p4']);
    expect(removePage({ ...base, pages: [base.pages[0]!] }, 'p1').pages.length).toBe(1);
    expect(movePage(base, 'p2', -1).pages.map((p) => p.id)).toEqual(['p2', 'p1', 'p3', 'p4']);
    expect(movePage(base, 'p1', -1)).toEqual(base);
    expect(movePage(base, 'p4', 1)).toEqual(base);
    expect(movePage(base, 'zzz', 1)).toEqual(base);
  });
});
