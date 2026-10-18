import { useMemo, useState } from 'react';

import { pickInstalledRegion } from './coverage';
import { installedRegionStore } from './fileApi';
import { resolveMapStyle, type ResolvedMapStyle } from './style';
import type { InstalledRegion } from './storage';

export interface BikeMapStyleOptions {
  /** `day` and `night` are the ride palettes (high contrast), not the app theme. */
  variant: 'day' | 'night';
  position: { lat: number; lon: number } | null;
}

export interface BikeMapStyleResult {
  style: ResolvedMapStyle;
  /** An installed offline region covers the position (`style.source === 'offline'`). False means the page must say the map needs signal. */
  covered: boolean;
  region: InstalledRegion | null;
}

/**
 * The basemap for the ride screen: the offline region that covers the rider when one is installed, else OpenFreeMap online.
 * The installed list is read once per mount (regions are installed from Settings, not while riding). The chosen region sticks
 * until the rider is clearly outside it, so the map does not remount along a region edge.
 */
export function useBikeMapStyle({ variant, position }: BikeMapStyleOptions): BikeMapStyleResult {
  const [installed] = useState(() => installedRegionStore.read());
  const [current, setCurrent] = useState<InstalledRegion | null>(null);
  const region = pickInstalledRegion(installed, position, current);
  if (region !== current) setCurrent(region);

  const regionKey = region ? `${region.id}:${region.version}` : null;
  const style = useMemo(
    () => resolveMapStyle({ theme: variant === 'night' ? 'dark' : 'light', ride: true, region }),
    // `region` is identified by id and version: a new object with the same file is the same style.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, regionKey],
  );
  return { style, covered: region !== null, region };
}
