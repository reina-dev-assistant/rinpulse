import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface TabBarInsetValue {
  /** Height the floating tab bar (and the live-recording pill above it) covers at the bottom of a tab screen, 0 where the bar is hidden. */
  inset: number;
  setInset: (height: number) => void;
}

const TabBarInsetContext = createContext<TabBarInsetValue>({ inset: 0, setInset: () => {} });

/**
 * The tab bar floats over the screens (it is not a row of the navigator), so content scrolls underneath it. The bar reports the
 * height it really covers (`TabBarWithLive` measures its overlay: pill, gaps, bottom inset, and the live pill when shown) and
 * every scrolling screen pads the end of its content by it (`useTabBarInset`), so the last item can still scroll fully above the bar.
 */
export function TabBarInsetProvider({ children }: { children: ReactNode }) {
  const [inset, setInset] = useState(0);
  const value = useMemo(() => ({ inset, setInset }), [inset]);
  return <TabBarInsetContext.Provider value={value}>{children}</TabBarInsetContext.Provider>;
}

/** Bottom padding for the content of a scrolling screen under the tab bar; 0 on a screen with no bar (live workout, a modal). */
export function useTabBarInset(): number {
  return useContext(TabBarInsetContext).inset;
}

/** For the bar itself: reports the covered height. */
export function useReportTabBarInset(): (height: number) => void {
  return useContext(TabBarInsetContext).setInset;
}
