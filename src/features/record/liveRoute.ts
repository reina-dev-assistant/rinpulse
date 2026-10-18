/**
 * The live recording screen and how everything reaches it. One definition: the Android notification (through `openUrl`), the pill above
 * the tab bar, the card on the Workouts tab and the back handling of the screen itself all import from here. Pure, no React Native.
 *
 * Whatever way the screen is opened, Workouts stack is `[index, record]` while a recording is prepared or running, so back (the hardware
 * key, the header arrow, the iOS swipe) is a plain pop that lands on the Workouts list, where the live card is pinned. The stack is
 * built that way (`router.navigate(LIVE_ROUTE, OPEN_LIVE)` for a stack that does not exist yet, `anchorLiveStack` for one that does)
 * instead of intercepting the pop: a `beforeRemove` listener cannot hold back an iOS swipe, which has already dismissed the native
 * screen when the event fires.
 */
import type { RecordingPhase } from './controller';
import type { RecorderStatus } from './recorder';

/** The URL scheme of the app (`scheme` in app.json). */
export const APP_SCHEME = 'joyofit';

/** The Workouts list: where back from the live screen lands. */
export const WORKOUTS_ROUTE = '/workouts' as const;

/** The live recording screen (`src/app/workouts/record.tsx`). */
export const LIVE_ROUTE = '/workouts/record' as const;

/** The link the recording notification opens; `src/app/+native-intent.ts` maps it to `LIVE_ROUTE`. */
export const LIVE_URL = `${APP_SCHEME}://${LIVE_ROUTE.slice(1)}`;

/** Names of the screens of the Workouts stack (`src/app/workouts/_layout.tsx`) that the live screen sits on. */
export const WORKOUTS_STACK = { list: 'index', live: 'record' } as const;

/**
 * Options for `router.navigate(LIVE_ROUTE, OPEN_LIVE)`. `navigate` reuses the live screen when it is already the top one (no duplicates),
 * and `withAnchor` puts the Workouts list under it when the Workouts stack is created by this very call.
 */
export const OPEN_LIVE = { withAnchor: true } as const;

/** A recording is prepared (GPS and sensors connecting), running, paused, being saved or waiting to be saved again. */
export function isLive(phase: RecordingPhase): boolean {
  return phase !== 'idle';
}

/** The recording has a sport and a phase worth showing: the rule for the live card on the Workouts tab and for the pill. */
export function hasLive(phase: RecordingPhase, sport: unknown): boolean {
  return isLive(phase) && sport !== null;
}

/** `pathname` (from `usePathname()`) is the live screen. */
export function isLivePath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === LIVE_ROUTE;
}

/** What the live card and pill say; each value has its own wording. */
export type LiveState = 'ready' | 'unsaved' | 'paused' | 'recording';

export function liveState(phase: RecordingPhase, status: RecorderStatus): LiveState {
  if (phase === 'ready') return 'ready';
  if (status === 'finished' && phase === 'active') return 'unsaved';
  if (status === 'paused') return 'paused';
  return 'recording';
}

/** The pill above the tab bar: while a recording exists, except on the live screen itself and where the tab bar is hidden (onboarding). */
export function showLivePill(input: { phase: RecordingPhase; sport: unknown; pathname: string; tabBarHidden: boolean }): boolean {
  return hasLive(input.phase, input.sport) && !isLivePath(input.pathname) && !input.tabBarHidden;
}

/**
 * The routes of the Workouts stack, reshaped for a live screen so that back always lands on the list: when a recording is live, whatever
 * sits under the live screen (nothing, Manual entry, a workout detail) is replaced by the list route, which keeps its own entry (and its
 * scroll position) when it is already first. Routes above the live screen stay. Null when the stack is already right, the recording is
 * not live (back is the default pop then: the setup screen has nothing to protect) or the live screen is not in the stack.
 */
export function anchorLiveStack<R extends { name: string }>(
  routes: readonly R[],
  phase: RecordingPhase,
  makeList: () => R,
): R[] | null {
  if (!isLive(phase)) return null;
  const at = routes.findIndex((r) => r.name === WORKOUTS_STACK.live);
  if (at < 0) return null;
  if (at === 1 && routes[0].name === WORKOUTS_STACK.list) return null;
  const list = routes[0].name === WORKOUTS_STACK.list ? routes[0] : makeList();
  return [list, ...routes.slice(at)];
}
