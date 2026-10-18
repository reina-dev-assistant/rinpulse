/**
 * ReplayScene -> SVG string, for the headless render (tests, the frame sequence and MP4 preview of `scripts/replay-preview.ts`)
 * and a web preview. Leaves go through the sticker engine's own `toSvg`, so shapes and text are the same markup a sticker
 * produces; only `mgroup` is written here. Runs of leaves between groups are emitted as one `toSvg` call, and its gradient and
 * clip ids are namespaced per run so they cannot collide.
 */
import { toSvg } from '@/features/stickers/core/emit-svg';
import type { SceneNode } from '@/features/stickers/core/scene';
import type { FontMap } from '@/features/stickers/core/text';

import type { MatrixGroup, ReplayNode, ReplayScene } from './scene';

const n = (v: number) => String(Math.round(v * 1000) / 1000);

function leaves(batch: SceneNode[], fonts: FontMap, run: number): string {
  const svg = toSvg({ width: 1080, height: 1920, nodes: batch, transparent: false, needsImages: [], issues: [] }, { fonts });
  const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
  return inner.replace(/(id="|url\(#)([gc]\d+)/g, `$1$2_${run}`);
}

function emit(nodes: readonly ReplayNode[], fonts: FontMap, counter: { run: number }): string {
  let out = '';
  let batch: SceneNode[] = [];
  const flush = () => {
    if (batch.length > 0) out += leaves(batch, fonts, counter.run++);
    batch = [];
  };
  for (const node of nodes) {
    if (node.k === 'mgroup') {
      flush();
      const g: MatrixGroup = node;
      out += `<g transform="translate(${n(g.tx)} ${n(g.ty)}) scale(${n(g.sx)} ${n(g.sy)})"${g.opacity !== undefined && g.opacity < 1 ? ` opacity="${n(g.opacity)}"` : ''}>${emit(g.children, fonts, counter)}</g>`;
    } else {
      batch.push(node);
    }
  }
  flush();
  return out;
}

export function replayToSvg(scene: ReplayScene, fonts: FontMap): string {
  const body = emit(scene.nodes, fonts, { run: 0 });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" text-rendering="geometricPrecision">${body}</svg>`;
}
