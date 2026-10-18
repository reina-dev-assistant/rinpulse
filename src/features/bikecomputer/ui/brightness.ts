/**
 * Screen dimming for the ride screen. `expo-brightness` is a native module that an older binary may not have (docs/bike-computer.md
 * section 10): it is required lazily, like `strength/keepAwake.ts`, and every call does nothing when it is missing. Nothing runs at
 * import time.
 *
 * Same idea as the module's `useSystemBrightness`: the level the person had is saved when the ride screen starts controlling it and put
 * back when it stops (Android has a call that hands the window back to the system setting; iOS changes the system value itself, so the
 * saved number is written back).
 */
import { Platform } from 'react-native';

interface BrightnessModule {
  getBrightnessAsync: () => Promise<number>;
  setBrightnessAsync: (value: number) => Promise<void>;
  restoreSystemBrightnessAsync?: () => Promise<void>;
}

let saved: number | null = null;
let controlling = false;

function load(): BrightnessModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: an older binary lacks the module
    return require('expo-brightness') as BrightnessModule;
  } catch {
    return null;
  }
}

/** Remembers the current brightness. Call once when the ride screen starts; a second call while controlling does nothing. */
export async function beginBrightnessControl(): Promise<void> {
  if (controlling) return;
  const module = load();
  if (!module) return;
  controlling = true;
  try {
    saved = await module.getBrightnessAsync();
  } catch {
    saved = null;
  }
}

/** Sets the window brightness to `level` (0..1, clamped). Does nothing before `beginBrightnessControl` or without the module. */
export async function setRideBrightness(level: number): Promise<void> {
  if (!controlling) return;
  try {
    await load()?.setBrightnessAsync(Math.min(1, Math.max(0, level)));
  } catch {
    // a binary without the native module, or the system refused: the screen stays as it is
  }
}

/** Puts the saved brightness back and keeps controlling it (the screen woke up; it may dim again). */
export async function restoreRideBrightness(): Promise<void> {
  if (!controlling) return;
  const module = load();
  if (!module) return;
  try {
    if (Platform.OS === 'android' && module.restoreSystemBrightnessAsync) await module.restoreSystemBrightnessAsync();
    else if (saved !== null) await module.setBrightnessAsync(saved);
  } catch {
    // see setRideBrightness
  }
}

/** Puts the saved brightness back and stops controlling it. Safe to call twice and on unmount. */
export async function endBrightnessControl(): Promise<void> {
  if (!controlling) return;
  await restoreRideBrightness();
  controlling = false;
  saved = null;
}
