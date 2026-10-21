/**
 * Where the floating tab bar is shown. Pure, so the mapping is unit tested.
 *
 * "More" (`settings`, the Settings stack) is the fourth tab; the Watch hub and the other hidden tabs are details of a tab and have no bar.
 */

/** The route name of the "More" tab. It is the Settings stack, so `/settings` and every `/settings/*` link keep working. */
export const MORE_ROUTE = 'settings';

/** The tabs whose stack index is a top-level root: Today, Workouts, Social and More (the Settings stack). */
const ROOT_TABS: Record<string, true> = { index: true, workouts: true, social: true, [MORE_ROUTE]: true };

/** The route name a stack's first screen has (`app/<tab>/index.tsx`). */
const STACK_ROOT = 'index';

/**
 * True when the floating bar is shown: the focused tab is Today, Workouts, Social or More and the screen on top of its stack is
 * that tab's root list (`focusedChild` is the stack's focused route name, undefined while the stack has not mounted: Today has no
 * stack). Everything pushed on a tab's stack is a detail screen without the bar, and so are the hidden tabs (the Watch hub,
 * Routes, Family, Coach, Strength, Sleep, ...), which are details of a tab.
 */
export function isTabRoot(focusedTab: string, focusedChild: string | undefined): boolean {
  if (!Object.hasOwn(ROOT_TABS, focusedTab)) return false;
  return focusedChild === undefined || focusedChild === STACK_ROOT;
}
