import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type GlyphName = ComponentProps<typeof MaterialCommunityIcons>['name'];
/** Compile-time check that every listed name is a real Material Design Icons glyph. */
type Glyphs<T extends GlyphName> = T;

/**
 * The pictograms workouts are told apart by. Ionicons has no running person, so sport types use Material Design Icons
 * (`MaterialCommunityIcons`); every other icon in the app stays Ionicons.
 */
export type SportIconName = Glyphs<
  | 'run'
  | 'run-fast'
  | 'walk'
  | 'hiking'
  | 'bike'
  | 'swim'
  | 'diving-scuba'
  | 'jump-rope'
  | 'rowing'
  | 'kayaking'
  | 'sail-boat'
  | 'surfing'
  | 'fish'
  | 'yoga'
  | 'meditation'
  | 'weight-lifter'
  | 'gymnastics'
  | 'stairs'
  | 'boxing-glove'
  | 'karate'
  | 'fencing'
  | 'dance-ballroom'
  | 'soccer'
  | 'football'
  | 'basketball'
  | 'volleyball'
  | 'handball'
  | 'tennis'
  | 'table-tennis'
  | 'badminton'
  | 'baseball'
  | 'cricket'
  | 'rugby'
  | 'golf'
  | 'hockey-sticks'
  | 'billiards'
  | 'bowling'
  | 'bullseye-arrow'
  | 'roller-skate'
  | 'skateboarding'
  | 'skate'
  | 'ski'
  | 'snowboard'
  | 'sledding'
  | 'horse-human'
  | 'parachute'
  | 'kite'
  | 'flag-checkered'
  | 'gamepad-variant'
  | 'heart-pulse'
>;

interface SportIconProps {
  name: SportIconName;
  size: number;
  color: string;
}

/** One sport pictogram; the glyph font is preloaded in the root layout. */
export function SportIcon({ name, size, color }: SportIconProps) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}
