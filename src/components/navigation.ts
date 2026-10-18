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
