import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { floatingTabBarFootprint } from '@/components/tabBarMetrics';
import { useTabBarInset } from '@/components/tabBarInset';

/**
 * How much of the screen's bottom the floating tab bar takes (`floatingTabBarFootprint`); the offset for an overlay that must sit above it.
 * Where the bar is not drawn (a detail screen) only the safe-area bottom inset remains.
 */
export function useFloatingTabBarFootprint(): number {
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const barShown = useTabBarInset() > 0;
  return barShown ? floatingTabBarFootprint(fontScale, insets.bottom, Platform.OS) : insets.bottom;
}
