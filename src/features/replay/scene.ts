/**
 * What the painters see. The leaves are the sticker engine's own Scene nodes (rect, ellipse, path, text, group), so the
 * replay text and shapes are painted exactly like a sticker's; the one addition is `mgroup`, a group with a scale and a
 * translation, which carries the moving map. Nodes are immutable and reused between frames: a painter may skip a node it
 * has already drawn when it receives the same object again, which is what keeps the map cheap.
 */
import type { SceneNode } from '@/features/stickers/core/scene';

export interface MatrixGroup {
  k: 'mgroup';
  /** Stable key of the group (a tile, the map root). */
  id: string;
  children: readonly ReplayNode[];
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  opacity?: number;
}

export type ReplayNode = SceneNode | MatrixGroup;

export interface ReplayScene {
  width: number;
  height: number;
  nodes: readonly ReplayNode[];
}
