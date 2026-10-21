import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback } from 'react';

import { useTheme } from '@/theme';

/**
 * Shared options for the nested stacks. Pushed screens get a flat native header in the paper color
 * with a bold Plus Jakarta title; tab-root screens turn the header off and draw their own title.
 */
export function useStackOptions() {
  const { colors, fonts } = useTheme();
  return {
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.foreground,
    headerShadowVisible: false,
    // No "index" (the previous route's name) next to the chevron: iOS shows the back title, Android usually does not.
    headerBackTitle: '',
    headerBackButtonDisplayMode: 'minimal',
    headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18, color: colors.foreground },
    contentStyle: { backgroundColor: colors.background },
  } as const;
}

/**
 * Hides the floating tab bar while this screen is focused and `hidden` is true (a full-screen view such as the bike computer). The tab
 * navigator is the parent of the tab's stack; `tabBarStyle: { display: 'none' }` is the convention `FloatingTabBar` reads.
 */
export function useHideTabBar(hidden: boolean) {
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      if (!hidden) return;
      const tabs = navigation.getParent();
      tabs?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => tabs?.setOptions({ tabBarStyle: undefined });
    }, [navigation, hidden]),
  );
}
