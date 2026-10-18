/**
 * Golden snapshots: every built-in template renders its primary fixture in dark and light to a small PNG that is compared with
 * `__goldens__/`. A layout, color or text change is a red test; run `UPDATE_GOLDENS=1 bun test src/features/stickers/testing`
 * after an intended change and review the PNGs (and `bun scripts/stickers-sheet.ts` for the full-size contact sheets).
 * Alongside it, the Scene of each render is hashed so a drift that the pixel tolerance would hide still shows up.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { applyLocale } from '@/i18n';

import { TEMPLATES } from '../catalog';
import { lookupPath } from '../core/expr';
import { FIXTURES, FIXTURE_PHOTOS } from './fixtures';
import { rasterize, renderTemplate, type RasterJob } from './render';

const GOLDENS = join(import.meta.dir, '__goldens__');
const UPDATE = process.env.UPDATE_GOLDENS === '1';
const TMP = join(process.env.TMPDIR ?? '/tmp', 'stickers-golden');
const MODES = ['dark', 'light'] as const;

function primaryFixture(kind: string, requires: readonly string[]) {
  return FIXTURES.filter((f) => f.kind === kind).find((f) => requires.every((path) => lookupPath(f.data, path) !== undefined));
}

/** FNV-1a over the scene JSON: cheap, stable, and independent of rasterizer anti-aliasing. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

describe('golden renders', () => {
  test('every template matches its golden PNG and scene hash', async () => {
    await applyLocale('id');
    mkdirSync(TMP, { recursive: true });
    const jobs: RasterJob[] = [];
    const hashes: Record<string, string> = {};
    for (const template of TEMPLATES) {
      // The Threads slides have their own goldens (`threadsGolden.test.ts`): one per fixture, not one per template.
      if (template.kind === 'threads') continue;
      const fixture = primaryFixture(template.kind, template.requires ?? []);
      if (!fixture) continue;
      for (const mode of MODES) {
        const name = `${template.id}__${mode}`;
        const assets = template.meta?.needsPhoto ? { photo: FIXTURE_PHOTOS[mode === 'dark' ? 'dusk' : 'day'] } : undefined;
        const rendered = renderTemplate(template, fixture.data, { locale: 'id', mode, assets });
        hashes[name] = hash(JSON.stringify(rendered.scene));
        const svg = join(TMP, `${name}.svg`);
        writeFileSync(svg, rendered.svg);
        jobs.push({ svg, png: join(TMP, `${name}.png`), width: 300, golden: name });
      }
    }
    const results = join(TMP, 'results.json');
    await rasterize(TMP, jobs, [], { dir: GOLDENS, update: UPDATE, maxDiffRatio: 0.004, channelTolerance: 28, results });
    const outcome = JSON.parse(readFileSync(results, 'utf8')) as { name: string; ok: boolean; ratio: number; reason?: string }[];
    expect(outcome.filter((r) => !r.ok)).toEqual([]);

    const hashFile = join(GOLDENS, 'scene-hashes.json');
    if (UPDATE || !existsSync(hashFile)) writeFileSync(hashFile, `${JSON.stringify(hashes, null, 2)}\n`);
    else {
      const known = JSON.parse(readFileSync(hashFile, 'utf8')) as Record<string, string>;
      const changed = Object.keys(hashes).filter((name) => known[name] !== hashes[name]);
      expect(changed).toEqual([]);
    }
  }, 120_000);
});
