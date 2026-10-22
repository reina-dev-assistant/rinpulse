/**
 * Where the floating tab bar is shown. Pure, so the mapping is unit tested.
 *
 * "More" (`settings`, the Settings stack) is the fourth tab; the Watch hub and the other hidden tabs are details of a tab and have no bar.
 */

/** The route name of the "More" tab. It is the Settings stack, so `/settings` and every `/settings/*` link keep working. */
export const MORE_ROUTE = 'settings';

/** The Social feed's tab, and the server-only feed behind it. */
export const SOCIAL_ROUTE = 'social';

/** What takes Social's place in local-only mode: the health metrics this phone stores itself. */
export const HEALTH_ROUTE = 'health';

/** The route name a stack's first screen has (`app/<tab>/index.tsx`). */
const STACK_ROOT = 'index';

/**
 * The tabs whose stack index is a top-level root. `health` is only a root in local-only mode (see `rootTabs`); on an
 * account build it stays the hidden detail screen Today pushes onto.
 */
const ROOT_TABS: Record<string, true> = {
  index: true,
  workouts: true,
  [SOCIAL_ROUTE]: true,
  [HEALTH_ROUTE]: true,
  [MORE_ROUTE]: true,
};

/** Which route fills the third tab slot. Social sells the JoyoRogo account; a local-only phone has none, so it shows Health instead of an empty tab. */
export function thirdTabRoute(localOnly: boolean): string {
  return localOnly ? HEALTH_ROUTE : SOCIAL_ROUTE;
}

/**
 * True when the floating bar is shown: the focused tab is Today, Workouts, the third tab (Social, or Health in
 * local-only mode) or More, and the screen on top of its stack is that tab's root list (`focusedChild` is the stack's
 * focused route name, undefined while the stack has not mounted: Today has no stack).
 *
 * Everything pushed on a tab's stack is a detail screen without the bar, and so are the hidden tabs (the Watch hub,
 * Routes, Family, Coach, Strength, Sleep, ...), which are details of a tab. Health counts only while it *is* the
 * third tab; on an account build `/health` is one of those details.
 */
export function isTabRoot(focusedTab: string, focusedChild: string | undefined, localOnly = false): boolean {
  if (focusedTab === HEALTH_ROUTE && !localOnly) return false;
  if (!Object.hasOwn(ROOT_TABS, focusedTab)) return false;
  return focusedChild === undefined || focusedChild === STACK_ROOT;
}
