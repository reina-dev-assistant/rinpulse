/**
 * The page layout of the ride screen: a list of pages, each a grid of 1, 2, 4, 6 or 8 fields or a map, climb or laps page. Pure.
 * Stored as JSON; `normalizeLayout` repairs anything that was stored by another version or edited by hand.
 */
import { FIELD_IDS, GRID_SIZES, MAX_PAGES, type BikeLayout, type FieldId, type FieldsPage, type GridSize, type RidePage } from '../types';

const FIELD_SET: ReadonlySet<string> = new Set(FIELD_IDS);
const isFieldId = (v: unknown): v is FieldId => typeof v === 'string' && FIELD_SET.has(v);
const isGrid = (v: unknown): v is GridSize => typeof v === 'number' && (GRID_SIZES as readonly number[]).includes(v);

/** What an empty slot is filled with, in this order, skipping fields already on the page. */
const FILLERS: readonly FieldId[] = ['speed', 'movingTime', 'distance', 'hr', 'cadence', 'power', 'avgSpeed', 'ascent', 'grade', 'elapsedTime', 'timeOfDay', 'calories'];

function filled(fields: readonly FieldId[], size: number): FieldId[] {
  const out = fields.slice(0, size);
  for (const f of FILLERS) {
    if (out.length >= size) break;
    if (!out.includes(f)) out.push(f);
  }
  // More slots than fillers (8 slots, 12 fillers: cannot happen) would repeat the first one.
  while (out.length < size) out.push('speed');
  return out;
}

function nextId(pages: readonly RidePage[]): string {
  const used = new Set(pages.map((p) => p.id));
  let n = pages.length + 1;
  while (used.has(`p${n}`)) n += 1;
  return `p${n}`;
}

export function defaultLayout(hasRoute: boolean): BikeLayout {
  const pages: RidePage[] = [
    { id: 'p1', kind: 'fields', grid: 6, fields: ['movingTime', 'speed', 'distance', 'hr', 'cadence', 'power'] },
    { id: 'p2', kind: 'fields', grid: 4, fields: ['avgSpeed', 'maxSpeed', 'ascent', 'grade'] },
    { id: 'p3', kind: 'map' },
  ];
  if (hasRoute) pages.push({ id: 'p4', kind: 'climb' });
  pages.push({ id: hasRoute ? 'p5' : 'p4', kind: 'laps' });
  return { version: 1, pages };
}

/** A stored layout made safe: unknown fields and pages dropped, slot counts fixed, ids unique, never empty. */
export function normalizeLayout(raw: unknown, hasRoute: boolean): BikeLayout {
  const pagesRaw = (raw as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pagesRaw)) return defaultLayout(hasRoute);
  const pages: RidePage[] = [];
  const seenSpecial = new Set<string>();
  for (const item of pagesRaw) {
    if (pages.length >= MAX_PAGES) break;
    const page = item as { id?: unknown; kind?: unknown; grid?: unknown; fields?: unknown } | null;
    if (!page || typeof page !== 'object') continue;
    const id = typeof page.id === 'string' && page.id.length > 0 && page.id.length <= 24 && !pages.some((p) => p.id === page.id) ? page.id : nextId(pages);
    if (page.kind === 'fields') {
      if (!isGrid(page.grid)) continue;
      const fields = Array.isArray(page.fields) ? page.fields.filter(isFieldId) : [];
      pages.push({ id, kind: 'fields', grid: page.grid, fields: filled(fields, page.grid) });
    } else if (page.kind === 'map' || page.kind === 'climb' || page.kind === 'laps') {
      if (seenSpecial.has(page.kind)) continue;
      seenSpecial.add(page.kind);
      pages.push({ id, kind: page.kind });
    }
  }
  return pages.length > 0 ? { version: 1, pages } : defaultLayout(hasRoute);
}

const mapPage = (layout: BikeLayout, pageId: string, fn: (p: FieldsPage) => FieldsPage): BikeLayout => ({
  ...layout,
  pages: layout.pages.map((p) => (p.id === pageId && p.kind === 'fields' ? fn(p) : p)),
});

export function setSlot(layout: BikeLayout, pageId: string, slot: number, field: FieldId): BikeLayout {
  if (!isFieldId(field)) return layout;
  return mapPage(layout, pageId, (p) => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= p.grid) return p;
    const fields = p.fields.slice();
    fields[slot] = field;
    return { ...p, fields };
  });
}

export function setGrid(layout: BikeLayout, pageId: string, grid: GridSize): BikeLayout {
  if (!isGrid(grid)) return layout;
  return mapPage(layout, pageId, (p) => ({ ...p, grid, fields: filled(p.fields, grid) }));
}

/** Adds a page at the end. At most `MAX_PAGES` pages, and one each of map, climb and laps. */
export function addPage(layout: BikeLayout, kind: RidePage['kind']): BikeLayout {
  if (layout.pages.length >= MAX_PAGES) return layout;
  if (kind !== 'fields' && layout.pages.some((p) => p.kind === kind)) return layout;
  const id = nextId(layout.pages);
  const page: RidePage = kind === 'fields' ? { id, kind, grid: 4, fields: filled([], 4) } : { id, kind };
  return { ...layout, pages: [...layout.pages, page] };
}

/** Removes a page; the last page cannot be removed. */
export function removePage(layout: BikeLayout, pageId: string): BikeLayout {
  if (layout.pages.length <= 1) return layout;
  return { ...layout, pages: layout.pages.filter((p) => p.id !== pageId) };
}

export function movePage(layout: BikeLayout, pageId: string, delta: -1 | 1): BikeLayout {
  const i = layout.pages.findIndex((p) => p.id === pageId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layout.pages.length) return layout;
  const pages = layout.pages.slice();
  const a = pages[i];
  const b = pages[j];
  if (!a || !b) return layout;
  pages[i] = b;
  pages[j] = a;
  return { ...layout, pages };
}
