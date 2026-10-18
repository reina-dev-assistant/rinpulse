import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, G } from 'react-native-svg';

import type { SceneNode } from '@/features/stickers/core/scene';
import type { FontMap } from '@/features/stickers/core/text';
import { drawNode, type DrawEnv, type PaintDefs } from '@/features/stickers/ui/ScenePainter';

import type { MatrixGroup, ReplayNode, ReplayScene } from '../scene';

/** Ids of gradients and clips must be unique across the whole Svg, and every leaf is its own memoised component. */
let leafIds = 0;

interface NodeProps {
  node: ReplayNode;
  fonts: FontMap;
}

/** One sticker-engine node, drawn by the sticker painter's own `drawNode`; skipped when it gets the same node object again. */
const Leaf = memo(function Leaf({ node, fonts }: { node: SceneNode; fonts: FontMap }) {
  const [id] = useState(() => leafIds++);
  const { element, defs } = useMemo(() => {
    let counter = 0;
    const paintDefs: PaintDefs = { defs: [], next: () => `rp${id}g${counter++}` };
    const env: DrawEnv = { defs: paintDefs, fonts, clipCounter: { n: id * 1000 } };
    return { element: drawNode(node, 'n', env), defs: paintDefs.defs };
  }, [node, fonts, id]);
  return (
    <>
      {defs.length > 0 ? <Defs>{defs}</Defs> : null}
      {element}
    </>
  );
});

const Group = memo(function Group({ node, fonts }: { node: MatrixGroup; fonts: FontMap }) {
  return (
    <G transform={`translate(${node.tx} ${node.ty}) scale(${node.sx} ${node.sy})`} opacity={node.opacity}>
      {node.children.map((child, i) => (
        <Node key={child.k === 'mgroup' ? child.id : `n${i}`} node={child} fonts={fonts} />
      ))}
    </G>
  );
});

function Node({ node, fonts }: NodeProps) {
  return node.k === 'mgroup' ? <Group node={node} fonts={fonts} /> : <Leaf node={node} fonts={fonts} />;
}

export interface ReplayPainterProps {
  scene: ReplayScene;
  fonts: FontMap;
  /** Width in dp; 1080 / PixelRatio makes a view-shot capture exactly 1080 px wide. */
  width: number;
}

/**
 * The native painter of a replay frame: the scene on react-native-svg, no layout of its own. The map root group is the only
 * node that is new every frame; tiles and every static node are the same objects as in the previous frame and are skipped.
 */
export const ReplayPainter = memo(function ReplayPainter({ scene, fonts, width }: ReplayPainterProps) {
  const height = (width * scene.height) / scene.width;
  return (
    <View collapsable={false} style={{ width, height, overflow: 'hidden' }}>
      <Svg width={width} height={height} viewBox={`0 0 ${scene.width} ${scene.height}`}>
        {scene.nodes.map((node, i) => (
          <Node key={node.k === 'mgroup' ? node.id : `n${i}`} node={node} fonts={fonts} />
        ))}
      </Svg>
    </View>
  );
});
