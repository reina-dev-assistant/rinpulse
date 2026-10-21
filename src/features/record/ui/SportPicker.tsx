import { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/AppText';
import { useToggleMix } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { SportIcon, type SportIconName } from '@/components/SportIcon';
import { sportIcon } from '@/features/workouts/sportIcon';
import { MANUAL_SPORTS, SPORT_ROWS, type ManualSport } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { spacing, useTheme } from '@/theme';

/** A treadmill run reads as a run to `sportIcon`; the picker tells the two apart with the faster figure. */
function pickerIcon(sport: ManualSport): SportIconName {
  return sport === 'treadmill' ? 'run-fast' : sportIcon(SPORT_ROWS[sport].name);
}

const TILE_WIDTH = 92;
const TILE_HEIGHT = 76;

interface SportPickerProps {
  sport: ManualSport;
  onSport: (sport: ManualSport) => void;
}

/**
 * The sports of the phone recorder as a row of tiles, each a pictogram over its name; the chosen one is filled the way the filter
 * chips are. The row scrolls sideways and brings the chosen tile into view, so a sport that arrives preselected (the loop planner's)
 * is never off screen. Nothing moves by itself.
 */
export function SportPicker({ sport, onSport }: SportPickerProps) {
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const xs = useRef(new Map<ManualSport, number>());
  const placed = useRef(false);

  const reveal = (animated: boolean) => {
    const x = xs.current.get(sport);
    if (x === undefined) return;
    scroll.current?.scrollTo({ x: Math.max(0, x - spacing.lg), animated: animated && !reduced });
  };

  useEffect(() => {
    reveal(placed.current);
    placed.current = true;
    // `reveal` only reads refs and `sport`; the first call happens after the tiles reported their place (see `onTileLayout`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  const onTileLayout = (key: ManualSport) => (event: LayoutChangeEvent) => {
    xs.current.set(key, event.nativeEvent.layout.x);
    if (key === sport && !placed.current) reveal(false);
  };

  return (
    <ScrollView
      ref={scroll}
      horizontal
      accessibilityRole="radiogroup"
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.bleed}
      contentContainerStyle={styles.row}>
      {MANUAL_SPORTS.map((key) => (
        <View key={key} onLayout={onTileLayout(key)}>
          <Tile sport={key} selected={key === sport} onPress={() => onSport(key)} />
        </View>
      ))}
    </ScrollView>
  );
}

function Tile({ sport, selected, onPress }: { sport: ManualSport; selected: boolean; onPress: () => void }) {
  const { colors, radius, fonts } = useTheme();
  const mix = useToggleMix(selected);
  const label = sportLabel(SPORT_ROWS[sport].name);
  const ink = selected ? colors.background : colors.foreground;
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      scaleTo={0.96}
      style={[styles.tile, { borderRadius: radius.tile }]}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: mix.interpolate({ inputRange: [0, 1], outputRange: [colors.muted, colors.foreground] }) }]}
      />
      <SportIcon name={pickerIcon(sport)} size={26} color={ink} />
      <AppText variant="label" numberOfLines={2} color={ink} style={[styles.label, { fontFamily: selected ? fonts.bold : fonts.medium }]}>
        {label}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // The sheet pads its content by `spacing.lg`; the row reaches the screen edge so tiles slide under it.
  bleed: { marginHorizontal: -spacing.lg, flexGrow: 0 },
  row: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  tile: {
    width: TILE_WIDTH,
    minHeight: TILE_HEIGHT,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    overflow: 'hidden',
  },
  label: { fontSize: 12, lineHeight: 15, textAlign: 'center' },
});
