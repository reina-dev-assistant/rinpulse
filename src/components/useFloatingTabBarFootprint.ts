import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { floatingTabBarFootprint } from '@/components/tabBarMetrics';

/** How much of the screen's bottom the floating tab bar takes (`floatingTabBarFootprint`); the offset for an overlay that must sit above it. */
export function useFloatingTabBarFootprint(): number {
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return floatingTabBarFootprint(fontScale, insets.bottom);
}
