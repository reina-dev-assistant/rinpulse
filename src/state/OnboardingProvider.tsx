import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { isIos } from '@/components/IosUnavailable';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import { rememberedWatch } from '@/features/device/rememberedWatch';
import { localOnlyMode } from '@/features/settings/localOnly';
import {
  advance,
  back,
  chooseNoWatch,
  dismiss,
  parseState,
  resolveLaunch,
  serializeState,
  skip,
  startState,
  type OnboardingState,
  type StepContext,
} from '@/features/onboarding/flow';
import { HuaweiWear } from '@/wear';

/** The guide's progress, kept in the same key-value store as the other one-time flags. */
const STORAGE_KEY = 'joyofit.onboarding';

export interface OnboardingContextValue {
  /** The run on screen or the last one; null until the stored record has been read. */
  state: OnboardingState | null;
  /** Platform and build facts that decide which steps apply. */
  ctx: StepContext;
  /** Continue: the step is done, move on (past the last step the guide is completed). */
  next: () => void;
  /** Skip or Later. */
  skipStep: () => void;
  back: () => void;
  /** Skip setup: leave the whole guide; it is not shown again on its own. */
  dismissGuide: () => void;
  /** "Aku belum punya jam / jamku belum didukung": the phone-only route, which skips pairing. */
  chooseNoWatch: () => void;
  /** Settings, Setup guide: a fresh run from the first step. */
  open: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding must be used inside <OnboardingProvider>');
  return value;
}

/**
 * Owns the setup guide's state. At app start it reads the stored record and decides (`resolveLaunch`): a first launch opens the guide, a
 * run closed half-way resumes, and anyone who already has a paired watch is passed over. It opens at most once per app session and
 * only from the Today tab, so a file opened with JoyoFit (which routes to an import screen) is never covered.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const pathname = usePathname();
  // Navigating before the tabs are mounted throws; the key appears once they are.
  const navigatorReady = useRootNavigationState()?.key !== undefined;
  const ctx = useMemo<StepContext>(
    () => ({ platform: isIos ? 'ios' : 'android', cloudConfigured: CLOUD_CONFIGURED, localOnly: localOnlyMode() }),
    [],
  );
  const [state, setState] = useState<OnboardingState | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const launched = useRef(false);

  const store = useCallback((next: OnboardingState) => {
    setState(next);
    void Storage.setItem(STORAGE_KEY, serializeState(next)).catch(() => {});
  }, []);

  // Read the record once. A read that fails counts as "nothing stored", the same as a corrupt record.
  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = parseState(await Storage.getItem(STORAGE_KEY).catch(() => null));
      const paired = stored ? false : await rememberedWatch(db);
      if (!live) return;
      const decision = resolveLaunch({ stored, hasPairedWatch: paired });
      if (decision.persist) store(decision.persist);
      else setState(stored);
      if (decision.show) setPendingOpen(true);
    })();
    return () => {
      live = false;
    };
  }, [db, store]);

  useEffect(() => {
    if (!pendingOpen || launched.current || !navigatorReady) return;
    launched.current = true;
    setPendingOpen(false);
    if (pathname === '/') router.navigate('/onboarding');
  }, [pendingOpen, navigatorReady, pathname, router]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      ctx,
      next: () => state && store(advance(state, ctx)),
      skipStep: () => state && store(skip(state, ctx)),
      back: () => state && store(back(state, ctx)),
      dismissGuide: () => state && store(dismiss(state)),
      chooseNoWatch: () => state && store(chooseNoWatch(state, ctx)),
      open: () => {
        store(startState({ hasPairedWatch: HuaweiWear.getDevice() !== null || HuaweiWear.getBackgroundStatus().address !== null }));
        router.navigate('/onboarding');
      },
    }),
    [state, ctx, store, router],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
