import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { NATIVE_BUILD, loadGateConfig } from '@/features/updates/forceUpdate';
import { OTA_LAUNCH_TIMEOUT_MS, decideGate, shouldRecheckGate, type GateDecision } from '@/features/updates/forceUpdatePolicy';
import { OTA_ENABLED, refreshOtaAtLaunch } from '@/features/updates/useOtaUpdate';

/** 'gate' = the splash is still up (config and OTA check running), 'ota' = a newer bundle is downloading, 'open' = show the app. */
export type LaunchPhase = 'gate' | 'ota' | 'open';

interface UpdateGateValue {
  launch: LaunchPhase;
  decision: GateDecision;
  /** The cold-start check already said "block": the app tree is never mounted, instead of covered. */
  blockedAtLaunch: boolean;
  checking: boolean;
  /** Asks the server again, past every cache. Resolves to the new decision. */
  recheck: () => Promise<GateDecision>;
}

const NONE: GateDecision = { kind: 'none' };

const Ctx = createContext<UpdateGateValue>({
  launch: 'open',
  decision: NONE,
  blockedAtLaunch: false,
  checking: false,
  recheck: async () => NONE,
});

export const useUpdateGate = () => useContext(Ctx);

/**
 * Launch-time update gate (docs/force-update.md). Cold start: read the min/latest native build from the server
 * (cached 5 min, 4 s timeout, any failure opens the app), then, unless blocked, give a newer OTA bundle up to 8 s in
 * total to download and reload. Resume: the config is looked at again, at most every 5 min. Mounted above the
 * database and every other provider, so a logged-out phone is gated too and a blocked phone never opens the app.
 */
export function UpdateGateProvider({ children }: { children: ReactNode }) {
  const [launch, setLaunch] = useState<LaunchPhase>('gate');
  const [decision, setDecision] = useState<GateDecision>(NONE);
  const [blockedAtLaunch, setBlockedAtLaunch] = useState(false);
  const [checking, setChecking] = useState(false);
  const lastCheckedAt = useRef<number | null>(null);

  const refresh = useCallback(async (force: boolean): Promise<GateDecision> => {
    setChecking(true);
    try {
      const config = await loadGateConfig(force);
      lastCheckedAt.current = Date.now();
      const next = decideGate(config, NATIVE_BUILD, Platform.OS);
      setDecision(next);
      return next;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const started = Date.now();
      const first = await refresh(false);
      if (!live) return;
      if (first.kind === 'block') {
        setBlockedAtLaunch(true);
        setLaunch('open');
        return;
      }
      if (OTA_ENABLED) {
        await refreshOtaAtLaunch(OTA_LAUNCH_TIMEOUT_MS - (Date.now() - started), () => {
          if (live) setLaunch('ota');
        });
      }
      if (live) setLaunch('open');
    })();
    return () => {
      live = false;
    };
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && shouldRecheckGate(lastCheckedAt.current, Date.now())) void refresh(false);
    });
    return () => sub.remove();
  }, [refresh]);

  const recheck = useCallback(async () => {
    const next = await refresh(true);
    // Unblocked: the app mounts, and a later block on resume covers it instead of unmounting it (a recording may run).
    if (next.kind !== 'block') setBlockedAtLaunch(false);
    return next;
  }, [refresh]);
  const value = useMemo(
    () => ({ launch, decision, blockedAtLaunch, checking, recheck }),
    [launch, decision, blockedAtLaunch, checking, recheck],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
