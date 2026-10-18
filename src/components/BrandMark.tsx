import { Image, Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { brandAllowed, type Brand } from '@/components/brandRules';

const HEALTH_CONNECT = require('../../assets/brand-marks/health-connect.png');
const APPLE_HEALTH = require('../../assets/brand-marks/apple-health.png');

/** Strava orange, the fill behind the symbol. */
const STRAVA_ORANGE = '#FC5200';
const STRAVA_SYMBOL =
  'M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169';

/** Corner radius of the square tile at the default 36 dp; scales with `size`. */
const RADIUS_RATIO = 9 / 36;

interface BrandMarkProps {
  brand: Brand;
  /** Side of the square tile in dp. */
  size?: number;
}

/**
 * The real mark of a third party, never an icon-font stand-in. Always sits next to the brand name (a row title or a section
 * title); decorative for screen readers because that name already says it.
 *
 * - Strava: the symbol, white on Strava orange, in a rounded square. Strava's API kit ships only wordmark lockups, so the
 *   symbol is drawn from its public path as a plain reference to the feature (judgement call, see docs/brand-marks.md).
 * - Health Connect (Android) and Apple Health (iOS): the artwork exactly as supplied, with no mask, border or shadow. Apple's
 *   licence is strict about this, so it is not wrapped in a chip and renders nothing off iOS.
 */
export function BrandMark({ brand, size = 36 }: BrandMarkProps) {
  if (!brandAllowed(brand, Platform.OS)) return null;
  const box = { width: size, height: size };
  const hidden = { accessible: false, importantForAccessibility: 'no-hide-descendants' } as const;

  if (brand === 'strava') {
    return (
      <View
        {...hidden}
        style={[box, { borderRadius: size * RADIUS_RATIO, backgroundColor: STRAVA_ORANGE, alignItems: 'center', justifyContent: 'center' }]}>
        <Svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24">
          <Path fill="#FFFFFF" d={STRAVA_SYMBOL} />
        </Svg>
      </View>
    );
  }
  return (
    <View {...hidden} style={box}>
      <Image
        source={brand === 'apple-health' ? APPLE_HEALTH : HEALTH_CONNECT}
        style={box}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
