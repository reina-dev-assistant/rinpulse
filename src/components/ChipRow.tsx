import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Chip } from '@/components/Chip';
import { edgesFor, scrollTargetFor, type ChipBox } from '@/components/chipScroll';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { spacing, useColors } from '@/theme';

export interface ChipRowItem {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: 'button' | 'checkbox' | 'radio';
}

interface ChipRowProps {
  items: readonly ChipRowItem[];
  /** Side padding of the row; also how far the row reaches out of a padded screen so chips can slide to the screen edge. */
  inset?: number;
  /** Pull the row out by `inset` on both sides (a row inside a padded screen). Leave false when the parent already spans the screen. */
  bleed?: boolean;
  /** The color the edges fade into: the surface behind the row. */
  fadeColor?: string;
}

const FADE_WIDTH = 28;

/**
 * One row of filter chips. Every chip is as wide as its label, the row scrolls sideways, and a fade on the edge that still has chips
 * behind it tells you so. Choosing a chip that is partly out of view scrolls it in with a sliver of the next one showing. Nothing moves
 * on its own: a marquee that scrolls by itself cannot be read or tapped reliably, and it ignores the system "remove animations" setting.
 */
export function ChipRow({ items, inset = spacing.lg, bleed = true, fadeColor }: ChipRowProps) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const gradientId = useId().replace(/[^A-Za-z0-9]/g, '');
  const scroll = useRef<ScrollView>(null);
  const boxes = useRef(new Map<string, ChipBox>());
  const offset = useRef(0);
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [edges, setEdges] = useState({ start: false, end: false });
  const placed = useRef(false);

  const selectedKey = items.find((item) => item.selected)?.key ?? null;
  const fade = fadeColor ?? colors.background;

  const reveal = useCallback(
    (key: string | null, animated: boolean) => {
      if (key === null) return;
      const box = boxes.current.get(key);
      if (!box) return;
      const target = scrollTargetFor(box, offset.current, viewport, content, inset);
      if (target !== null) scroll.current?.scrollTo({ x: target, animated });
    },
    [viewport, content, inset],
  );

  // Once the row is measured, a chip that starts selected is already in view; afterwards every change of choice scrolls it in.
  useEffect(() => {
    if (viewport === 0 || content === 0) return;
    reveal(selectedKey, placed.current && !reduced);
    placed.current = true;
  }, [selectedKey, viewport, content, reveal, reduced]);

  useEffect(() => {
    setEdges(edgesFor(offset.current, viewport, content));
  }, [viewport, content]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.x;
    const next = edgesFor(offset.current, viewport, content);
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  };

  const onItemLayout = (key: string) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    boxes.current.set(key, { x, width });
  };

  return (
    <View style={bleed ? { marginHorizontal: -inset } : undefined}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => setViewport(e.nativeEvent.layout.width)}
        onContentSizeChange={(w) => setContent(w)}
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={[styles.content, { paddingHorizontal: inset }]}>
        {items.map((item) => (
          <View key={item.key} onLayout={onItemLayout(item.key)} style={styles.item}>
            <Chip label={item.label} selected={item.selected} onPress={item.onPress} role={item.role} />
          </View>
        ))}
      </ScrollView>
      {edges.start ? <Fade side="start" color={fade} id={`${gradientId}s`} /> : null}
      {edges.end ? <Fade side="end" color={fade} id={`${gradientId}e`} /> : null}
    </View>
  );
}

function Fade({ side, color, id }: { side: 'start' | 'end'; color: string; id: string }) {
  // Never fully opaque at the edge, so the chip behind it still reads as a chip.
  const edge = 0.9;
  return (
    <Svg pointerEvents="none" width={FADE_WIDTH} height="100%" style={[styles.fade, side === 'start' ? styles.start : styles.end]}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity={side === 'start' ? edge : 0} />
          <Stop offset="1" stopColor={color} stopOpacity={side === 'start' ? 0 : edge} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, alignItems: 'center' },
  item: { flexShrink: 0 },
  fade: { position: 'absolute', top: 0, bottom: 0 },
  start: { left: 0 },
  end: { right: 0 },
});
