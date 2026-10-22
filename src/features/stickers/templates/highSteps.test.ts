import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';
import type { Readiness } from '@/features/today/readiness';
import { buildTodaySubject } from '@/features/stickers/data/today';

import { TEMPLATES } from '../catalog';
import type { Scene, SceneNode, TextNode } from '../core/scene';
import { measureText } from '../core/text';
import { FIT_FONTS } from '../fonts';
import { renderTemplate } from '../testing/render';

const readiness: Readiness = { headline: 'Primed', signals: [], missing: [], recovery: null, hrvNote: null };
const NOW = new Date(2026, 9, 17, 14, 30).getTime();

function textNodes(nodes: readonly SceneNode[]): TextNode[] {
  return nodes.flatMap((node) => (node.k === 'text' ? [node] : node.k === 'group' ? textNodes(node.children) : []));
}

function extent(node: TextNode): [number, number] {
  const width = measureText(node.text, FIT_FONTS.metrics(node.font, node.weight), node.size) + (node.letterSpacing ?? 0) * node.text.length;
  if (node.anchor === 'middle') return [node.x - width / 2, node.x + width / 2];
  if (node.anchor === 'end') return [node.x - width, node.x];
  return [node.x, node.x + width];
}

function inside(scene: Scene): string[] {
  return textNodes(scene.nodes)
    .filter((node) => {
      const [left, right] = extent(node);
      return left < -1 || right > scene.width + 1;
    })
    .map((node) => node.text);
}

const CASES = [
  { steps: 7825, stepGoal: 8000 },
  { steps: 30_000, stepGoal: 8000 },
  { steps: 100_000, stepGoal: 8000 },
  { steps: 100_000, stepGoal: 100_000 },
  { steps: 99_999, stepGoal: 100_000 },
  { steps: 12_345, stepGoal: null },
];

describe('share cards at high step counts', () => {
  for (const locale of ['id', 'en'] as const) {
    test(`${locale}: every steps template keeps its numbers inside the card`, async () => {
      await applyLocale(locale);
      try {
        for (const c of CASES) {
          const subject = buildTodaySubject({ steps: c.steps, sleep: null, readiness, strain: null, stepGoal: c.stepGoal, restingHr: null, nowMs: NOW }, locale);
          for (const template of TEMPLATES.filter((t) => subject.kinds.includes(t.kind))) {
            if (template.meta?.needsPhoto) continue;
            for (const mode of ['dark', 'light'] as const) {
              const where = `${template.id} / ${c.steps} of ${c.stepGoal} / ${mode}`;
              const { scene, issues } = renderTemplate(template, subject.data, { locale, mode });
              expect({ where, issues }).toEqual({ where, issues: [] });
              expect({ where, outside: inside(scene) }).toEqual({ where, outside: [] });
            }
          }
        }
      } finally {
        await applyLocale('id');
      }
    });
  }

  test('the ring fraction is the plain ratio, past 1 for a day over the goal, and absent without a goal', () => {
    const data = (steps: number, stepGoal: number | null) =>
      buildTodaySubject({ steps, sleep: null, readiness, strain: null, stepGoal, restingHr: null, nowMs: NOW }, 'id').data.ready as Record<string, unknown>;
    expect(data(30_000, 8000).stepPct).toBe(3.75);
    expect(data(100_000, 8000).stepPct).toBe(12.5);
    expect(data(7825, 8000).stepPct).toBeCloseTo(0.978125, 10);
    expect('stepPct' in data(30_000, 0)).toBe(false);
    expect('stepPct' in data(0, 8000)).toBe(false);
  });

  test('the steps figure is printed whole, with its thousands separator', async () => {
    const subject = buildTodaySubject({ steps: 100_000, sleep: null, readiness, strain: null, stepGoal: 8000, restingHr: null, nowMs: NOW }, 'en');
    await applyLocale('en');
    try {
      const template = TEMPLATES.find((t) => t.id.startsWith('ready.') && !t.meta?.needsPhoto)!;
      const { scene } = renderTemplate(template, subject.data, { locale: 'en', mode: 'dark' });
      const printed = textNodes(scene.nodes).map((node) => node.text);
      expect(printed.some((text) => text.includes('100,000'))).toBe(true);
    } finally {
      await applyLocale('id');
    }
  });
});
