/**
 * Keeps the screen on while the logger is open. `expo-keep-awake` is autolinked by expo but may be missing from an older binary:
 * then every call does nothing instead of crashing.
 */
type KeepAwake = {
  activateKeepAwakeAsync: (tag?: string) => Promise<void>;
  deactivateKeepAwake: (tag?: string) => Promise<void>;
};

/** One tag per screen that holds the screen on, so two of them do not release each other's hold. */
const DEFAULT_TAG = 'strength';

function load(): KeepAwake | null {
  try {
    return require('expo-keep-awake') as KeepAwake;
  } catch {
    return null;
  }
}

export async function holdScreenOn(tag: string = DEFAULT_TAG): Promise<void> {
  try {
    await load()?.activateKeepAwakeAsync(tag);
  } catch {
    // a binary without the native module: the screen just follows the system timeout
  }
}

export async function releaseScreen(tag: string = DEFAULT_TAG): Promise<void> {
  try {
    await load()?.deactivateKeepAwake(tag);
  } catch {
    // see holdScreenOn
  }
}
