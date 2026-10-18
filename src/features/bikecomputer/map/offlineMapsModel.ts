import type { DownloadFailureKind, DownloadState } from './download';
import { isNewerVersion, type MapRegion, type RegionIndex } from './regions';
import type { InstalledRegion } from './storage';

/** What the "Peta offline" list shows per region. Pure: the section only renders these rows. */

export type RowStatus = 'available' | 'installed' | 'updatable' | 'downloading' | 'paused' | 'verifying' | 'failed';

export interface RegionRow {
  id: string;
  name: { id: string; en: string };
  /** Bytes the rider downloads (the catalog build) or, offline, what is on the phone. */
  bytes: number;
  status: RowStatus;
  /** 0 to 1 while downloading or paused; null otherwise. */
  progress: number | null;
  failure: DownloadFailureKind | null;
  installed: InstalledRegion | null;
  /** The catalog build to download or update to; null when the catalog could not be loaded. */
  latest: MapRegion | null;
}

export interface RowsInput {
  index: Pick<RegionIndex, 'regions'> | null;
  installed: readonly InstalledRegion[];
  state: DownloadState;
}

/** A download is in flight (or paused): only that region's buttons answer, the others wait. */
export function downloadBusy(state: DownloadState): boolean {
  return state.phase === 'downloading' || state.phase === 'paused' || state.phase === 'verifying';
}

export function regionName(name: { id: string; en: string }, locale: 'id' | 'en'): string {
  return name[locale];
}

function statusFor(
  id: string,
  installed: InstalledRegion | null,
  latest: MapRegion | null,
  state: DownloadState,
): Pick<RegionRow, 'status' | 'progress' | 'failure'> {
  if (state.phase !== 'idle' && state.regionId === id) {
    switch (state.phase) {
      case 'downloading':
      case 'paused':
        return { status: state.phase, progress: state.total > 0 ? Math.min(1, state.received / state.total) : 0, failure: null };
      case 'verifying':
        return { status: 'verifying', progress: 1, failure: null };
      case 'failed':
        return { status: 'failed', progress: null, failure: state.kind };
      default:
        break; // installed or cancelled: the registry below is the truth
    }
  }
  if (!installed) return { status: 'available', progress: null, failure: null };
  const outdated = latest !== null && isNewerVersion(latest.version, installed.version);
  return { status: outdated ? 'updatable' : 'installed', progress: null, failure: null };
}

/**
 * Catalog regions first (in catalog order), then installed regions the catalog does not list (offline, or a region dropped
 * from the catalog): those can be deleted but not downloaded.
 */
export function buildRows({ index, installed, state }: RowsInput): RegionRow[] {
  const byId = new Map(installed.map((r) => [r.id, r]));
  const rows: RegionRow[] = [];
  for (const latest of index?.regions ?? []) {
    const have = byId.get(latest.id) ?? null;
    byId.delete(latest.id);
    rows.push({
      id: latest.id,
      name: latest.name,
      bytes: latest.bytes,
      installed: have,
      latest,
      ...statusFor(latest.id, have, latest, state),
    });
  }
  for (const have of byId.values()) {
    rows.push({
      id: have.id,
      name: have.name,
      bytes: have.bytes,
      installed: have,
      latest: null,
      ...statusFor(have.id, have, null, state),
    });
  }
  return rows;
}
