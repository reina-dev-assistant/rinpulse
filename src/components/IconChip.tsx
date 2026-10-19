import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { SportIcon, type SportIconName } from '@/components/SportIcon';
import { tintColors, useColors, type Tint } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

const SIZES = { sm: 32, md: 40, lg: 48 } as const;

/** The glyph of a chip: an Ionicons name, or a sport pictogram (`sport`) when the chip stands for a workout type. */
export type ChipGlyph = { icon: IconName; sport?: never } | { sport: SportIconName; icon?: never };

type IconChipProps = ChipGlyph & {
  /** A data color, `neutral` for chrome that is not a metric, or `destructive` for an action that deletes or signs out. */
  tint?: Tint | 'neutral' | 'destructive';
  size?: keyof typeof SIZES;
  /** Fill behind the glyph; defaults to the tint's soft color. Pass `card` on tinted tiles. */
  background?: string;
};

/** One glyph, Ionicons or sport pictogram, at a given size and color. */
export function GlyphIcon({ glyph, size, color }: { glyph: ChipGlyph; size: number; color: string }) {
  return glyph.sport ? <SportIcon name={glyph.sport} size={size} color={color} /> : <Ionicons name={glyph.icon} size={size} color={color} />;
}

/** Soft-tinted round chip holding one icon. Decorative: hidden from screen readers. */
export function IconChip({ tint = 'neutral', size = 'md', background, ...glyph }: IconChipProps) {
  const colors = useColors();
  const box = SIZES[size];
  const scheme =
    tint === 'neutral'
      ? { soft: colors.muted, glyph: colors.foreground }
      : tint === 'destructive'
        ? { soft: colors.destructiveSoft, glyph: colors.destructive }
        : { soft: tintColors(colors, tint).soft, glyph: tintColors(colors, tint).text };
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: box,
        height: box,
        borderRadius: box / 2,
        backgroundColor: background ?? scheme.soft,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <GlyphIcon glyph={glyph} size={Math.round(box * 0.5)} color={scheme.glyph} />
    </View>
  );
}
