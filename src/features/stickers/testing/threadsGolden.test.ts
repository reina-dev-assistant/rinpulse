/**
 * Threads carousel goldens: every slide a fixture workout offers, rendered as the sheet would draw it (slide n of the offered
 * set) to a small PNG compared with `__goldens__/threads/`, plus the Scene hash. Fixtures: a run with splits, a ride with power,
 * a push day, a 30 km run (three pages of splits), twenty exercises (three pages of exercises), and two sparse sessions (the slides without data are not offered).
 * `UPDATE_GOLDENS=1 bun test src/features/stickers/testing/threadsGolden.test.ts` rewrites them.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyLocale } from '@/i18n';

import { slideData } from '../data/threads';
import { measureText } from '../core/text';
import type { SceneNode, TextNode } from '../core/scene';
import { FIT_FONTS } from '../fonts';
import { offeredSlides } from '../threads/slides';
import { rasterize, renderTemplate, type RasterJob } from './render';
import { THREADS_FIXTURES } from './threadsFixtures';

const GOLDENS = join(import.meta.dir, '__goldens__/threads');
const UPDATE = process.env.UPDATE_GOLDENS === '1';
const TMP = join(process.env.TMPDIR ?? '/tmp', 'threads-golden');

/** Slides each fixture offers, in carousel order: the contract of "slides with no data are skipped". */
const EXPECTED: Record<string, string[]> = {
  'threads.run': ['summary', 'splits', 'charts', 'sensors', 'zones', 'context'],
  'threads.ride': ['summary', 'splits', 'charts', 'sensors', 'zones', 'power', 'powerzones', 'climbs', 'context'],
  'threads.strength': ['lift', 'lifts', 'lifts2', 'muscle', 'contextlift'],
  'threads.longrun': ['summary', 'splits', 'splits2', 'splits3', 'charts', 'sensors', 'zones', 'context'],
  'threads.fullbody': ['lift', 'lifts', 'lifts2', 'lifts3', 'muscle'],
  'threads.walk': ['summary', 'splits', 'charts'],
  'threads.bodyweight': ['lift', 'lifts', 'muscle'],
};

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function textNodes(nodes: readonly SceneNode[]): TextNode[] {
  return nodes.flatMap((node) => (node.k === 'text' ? [node] : node.k === 'group' ? textNodes(node.children) : []));
}

describe('threads carousel', () => {
  test('each fixture offers exactly the slides it has data for', () => {
    for (const fixture of THREADS_FIXTURES) {
      const ids = offeredSlides(fixture.subject()).map((s) => s.id);
      expect({ key: fixture.key, ids }).toEqual({ key: fixture.key, ids: EXPECTED[fixture.key] });
    }
  });

  test('every slide renders cleanly in id and en, dark and light: inside the canvas, 22 px or more, no leaked key, branded', async () => {
    for (const locale of ['id', 'en'] as const) {
      await applyLocale(locale);
      try {
        for (const fixture of THREADS_FIXTURES) {
          const subject = fixture.subject();
          const slides = offeredSlides(subject);
          slides.forEach((slide, i) => {
            for (const mode of ['dark', 'light'] as const) {
              const where = `${fixture.key} / ${slide.id} / ${mode} / ${locale}`;
              const data = slideData(subject, { n: i + 1, total: slides.length });
              // The Pro watermark switch is off: the Threads set keeps its branding anyway.
              const { scene, issues } = renderTemplate(slide.template, data, {
                locale,
                mode,
                options: { watermark: false, hideNumbers: false, showName: false, privacy: { routeTrimMeters: 200 } },
              });
              expect({ where, issues }).toEqual({ where, issues: [] });
              expect({ where, w: scene.width, h: scene.height }).toEqual({ where, w: 1080, h: 1350 });
              const texts = textNodes(scene.nodes);
              for (const node of texts) {
                const width = measureText(node.text, FIT_FONTS.metrics(node.font, node.weight), node.size) + (node.letterSpacing ?? 0) * node.text.length;
                const left = node.anchor === 'middle' ? node.x - width / 2 : node.anchor === 'end' ? node.x - width : node.x;
                expect({ where, text: node.text, inside: left >= -1 && left + width <= 1081 }).toEqual({ where, text: node.text, inside: true });
                expect({ where, text: node.text, size: node.size >= 22 }).toEqual({ where, text: node.text, size: true });
                expect({ where, text: node.text, leaked: /threads\.|stickers:|undefined|NaN/.test(node.text) }).toEqual({ where, text: node.text, leaked: false });
              }
              const joined = texts.map((t) => t.text);
              expect({ where, link: joined.includes('fit.joyorogo.com'), name: joined.includes('JoyoFit'), pages: joined.includes(`${i + 1}/${slides.length}`) }).toEqual({ where, link: true, name: true, pages: true });
            }
          });
        }
      } finally {
        await applyLocale('id');
      }
    }
  });

  test('privacy: the route is trimmed at both ends, can be left out, and the name only shows when opted in', async () => {
    await applyLocale('id');
    const fixture = THREADS_FIXTURES.find((f) => f.key === 'threads.run')!;
    const subject = fixture.subject();
    const summary = offeredSlides(subject).find((s) => s.id === 'summary')!.template;
    const route = (trim: number, data = slideData(subject, { n: 1, total: 6 })) =>
      renderTemplate(summary, data, { locale: 'id', mode: 'dark', options: { watermark: true, hideNumbers: false, showName: false, privacy: { routeTrimMeters: trim } } }).scene.nodes.filter((n) => n.k === 'path').length;
    expect(route(200)).toBeGreaterThan(route(200, slideData(subject, { n: 1, total: 6 }, { showRoute: false })));

    // The engine binds `user.name` only when `options.showName` is on, whatever the data says.
    const names = (data: ReturnType<typeof slideData>, showName: boolean) =>
      textNodes(renderTemplate(summary, data, { locale: 'id', mode: 'dark', options: { watermark: true, hideNumbers: false, showName, privacy: { routeTrimMeters: 200 } } }).scene.nodes).map((t) => t.text);
    expect(names(slideData(subject, { n: 1, total: 6 }), false).some((t) => t.includes('Dzul'))).toBe(false);
    expect(names(slideData(subject, { n: 1, total: 6 }, { name: 'Dzul' }), false).some((t) => t.includes('Dzul'))).toBe(false);
    expect(names(slideData(subject, { n: 1, total: 6 }, { name: 'Dzul' }), true).some((t) => t.includes('Dzul'))).toBe(true);
  });

  test('goldens: every slide matches its PNG and scene hash', async () => {
    await applyLocale('id');
    mkdirSync(TMP, { recursive: true });
    mkdirSync(GOLDENS, { recursive: true });
    const jobs: RasterJob[] = [];
    const hashes: Record<string, string> = {};
    for (const fixture of THREADS_FIXTURES) {
      const subject = fixture.subject();
      const slides = offeredSlides(subject);
      slides.forEach((slide, i) => {
        for (const mode of ['dark', 'light'] as const) {
          if (mode === 'light' && !['threads.run', 'threads.strength'].includes(fixture.key)) continue;
          const name = `${fixture.key.replace('threads.', '')}__${slide.id}__${mode}`;
          const rendered = renderTemplate(slide.template, slideData(subject, { n: i + 1, total: slides.length }), { locale: 'id', mode });
          hashes[name] = hash(JSON.stringify(rendered.scene));
          const svg = join(TMP, `${name}.svg`);
          writeFileSync(svg, rendered.svg);
          jobs.push({ svg, png: join(TMP, `${name}.png`), width: 300, golden: name });
        }
      });
    }
    const results = join(TMP, 'results.json');
    await rasterize(TMP, jobs, [], { dir: GOLDENS, update: UPDATE, maxDiffRatio: 0.004, channelTolerance: 28, results });
    const outcome = JSON.parse(readFileSync(results, 'utf8')) as { name: string; ok: boolean }[];
    expect(outcome.filter((r) => !r.ok)).toEqual([]);

    const hashFile = join(GOLDENS, 'scene-hashes.json');
    if (UPDATE || !existsSync(hashFile)) writeFileSync(hashFile, `${JSON.stringify(hashes, null, 2)}\n`);
    else {
      const known = JSON.parse(readFileSync(hashFile, 'utf8')) as Record<string, string>;
      expect(Object.keys(hashes).filter((name) => known[name] !== hashes[name])).toEqual([]);
    }
  }, 180_000);
});
