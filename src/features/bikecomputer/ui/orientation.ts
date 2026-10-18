/**
 * Landscape for the ride screen. `app.json` allows every orientation and the root layout locks the app to portrait at start
 * (`lockPortrait`); the ride screen unlocks it and locks it again on leaving. `expo-screen-orientation` is a native module a binary built
 * before this branch does not have: lazy require, no-op when missing (such a binary stays portrait through its own manifest).
 */
interface OrientationModule {
  unlockAsync: () => Promise<void>;
  lockAsync: (lock: number) => Promise<void>;
  OrientationLock: { PORTRAIT_UP: number };
}

function load(): OrientationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: an older binary lacks the module
    return require('expo-screen-orientation') as OrientationModule;
  } catch {
    return null;
  }
}

/** Lets the ride screen rotate with the phone. */
export async function unlockRideOrientation(): Promise<void> {
  try {
    await load()?.unlockAsync();
  } catch {
    // the binary keeps its manifest orientation
  }
}

/** Back to portrait when the ride screen closes. */
export async function lockPortrait(): Promise<void> {
  try {
    const module = load();
    if (module) await module.lockAsync(module.OrientationLock.PORTRAIT_UP);
  } catch {
    // see unlockRideOrientation
  }
}
