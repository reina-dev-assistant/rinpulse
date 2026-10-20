import { useSyncExternalStore } from 'react';

/** A counter screens and hooks subscribe to, bumped when something they read has changed. */
class Version {
  private value = 0;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): number => this.value;

  bump(): void {
    this.value += 1;
    for (const l of this.listeners) l();
  }
}

/** A sample was stored (live or from the overnight file): the last reading changed, and so may a night's room aggregate. */
export const envVersion = new Version();
/** A thermometer was paired or forgotten, or a thermometer setting changed. */
export const pairingVersion = new Version();

export const useEnvVersion = (): number => useSyncExternalStore(envVersion.subscribe, envVersion.getSnapshot);
export const usePairingVersion = (): number => useSyncExternalStore(pairingVersion.subscribe, pairingVersion.getSnapshot);
