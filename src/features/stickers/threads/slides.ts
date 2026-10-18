/**
 * The slides of the Threads carousel: which templates exist, in which order, and which of them a subject can fill. A slide with no
 * data is not offered (its template `requires` a path the subject does not have), so a sparse workout gets a short carousel.
 */
import { isOffered } from '../offer';
import { TEMPLATES } from '../catalog';
import type { Template } from '../core/schema';
import { slideData } from '../data/threads';
import type { JsonObject, StickerSubject } from '../subject';

/** Threads: 4:5 portrait, 1080 x 1350 (docs/share-threads.md). */
export const THREADS_WIDTH = 1080;
export const THREADS_HEIGHT = 1350;

/** The carousel starts with this many slides on; the rest are off until the person turns them on. Threads accepts 20. */
export const THREADS_DEFAULT_SLIDES = 10;
export const THREADS_MAX_SLIDES = 20;

export interface ThreadsSlideDef {
  /** Stable id, also the picker label key (`stickers:threads.slide.<id>`). */
  id: string;
  /** Template id in the catalog. */
  templateId: string;
}

/** Display order: the slide ids of `templates/threads.ts`. */
export const THREADS_SLIDES: readonly ThreadsSlideDef[] = [
  'summary',
  'lift',
  'splits',
  'splits2',
  'splits3',
  'charts',
  'sensors',
  'zones',
  'power',
  'powerzones',
  'climbs',
  'lifts',
  'lifts2',
  'lifts3',
  'muscle',
  'context',
  'contextlift',
].map((id) => ({ id, templateId: `threads.${id}.portrait` }));

export interface OfferedSlide extends ThreadsSlideDef {
  template: Template;
}

/** The slides the subject has data for, in carousel order. */
export function offeredSlides(subject: Pick<StickerSubject, 'data'>, templates: readonly Template[] = TEMPLATES): OfferedSlide[] {
  const slides: OfferedSlide[] = [];
  for (const def of THREADS_SLIDES) {
    const template = templates.find((t) => t.id === def.templateId);
    if (template && isOffered(template, subject)) slides.push({ ...def, template });
  }
  return slides;
}

/** One entry of the person's carousel: a slide and whether it goes out. */
export interface SlideChoice {
  id: string;
  enabled: boolean;
}

/** The first `THREADS_DEFAULT_SLIDES` offered slides on, the others off. */
export function initialChoices(offered: readonly Pick<ThreadsSlideDef, 'id'>[]): SlideChoice[] {
  return offered.map((slide, i) => ({ id: slide.id, enabled: i < THREADS_DEFAULT_SLIDES }));
}

/**
 * The choices after the offer changed (another workout, or its data finished loading): slides that are still offered keep their
 * place and state, new ones are added in carousel order and on while the default count allows, gone ones disappear.
 */
export function reconcileChoices(previous: readonly SlideChoice[], offered: readonly Pick<ThreadsSlideDef, 'id'>[]): SlideChoice[] {
  const ids = offered.map((s) => s.id);
  const kept = previous.filter((c) => ids.includes(c.id));
  const known = new Set(kept.map((c) => c.id));
  let enabled = kept.filter((c) => c.enabled).length;
  const added: SlideChoice[] = [];
  for (const id of ids) {
    if (known.has(id)) continue;
    const on = enabled < THREADS_DEFAULT_SLIDES;
    if (on) enabled += 1;
    added.push({ id, enabled: on });
  }
  return [...kept, ...added];
}

/** Turns a slide on or off; turning one on past `THREADS_MAX_SLIDES` does nothing. */
export function toggleChoice(choices: readonly SlideChoice[], id: string): SlideChoice[] {
  const on = choices.filter((c) => c.enabled).length;
  return choices.map((c) => (c.id !== id ? c : c.enabled ? { ...c, enabled: false } : on >= THREADS_MAX_SLIDES ? c : { ...c, enabled: true }));
}

/** Moves the slide at `from` to `to` (clamped), keeping the others in order. */
export function moveChoice(choices: readonly SlideChoice[], from: number, to: number): SlideChoice[] {
  if (from < 0 || from >= choices.length) return [...choices];
  const target = Math.max(0, Math.min(choices.length - 1, to));
  const next = [...choices];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** The slides that go out, in the person's order. */
export function enabledSlides<T extends Pick<ThreadsSlideDef, 'id'>>(choices: readonly SlideChoice[], offered: readonly T[]): T[] {
  return choices.flatMap((c) => {
    const slide = c.enabled ? offered.find((s) => s.id === c.id) : undefined;
    return slide ? [slide] : [];
  });
}

/**
 * The data each slide of the set is drawn with: `th.n` is its place among the slides that go out and `th.total` their count, so
 * the counter follows every toggle and reorder. One call for the preview, the export and the tests.
 */
export function slideSetData(subject: Pick<StickerSubject, 'data'>, count: number, choices: { showRoute?: boolean; name?: string | null } = {}): JsonObject[] {
  return Array.from({ length: count }, (_, i) => slideData(subject, { n: i + 1, total: count }, choices));
}
