import { INDEX_URL, parseRegionIndex, type RegionIndex } from './regions';

export const INDEX_TIMEOUT_MS = 6000;

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

/**
 * The catalog from the maps bucket, or null when it cannot be had: no signal, a slow answer (`timeoutMs`, so the settings
 * screen never hangs on a dead connection), a non-200, or JSON that is not a valid index. Never throws; the caller shows the
 * installed regions with a note instead.
 */
export async function fetchRegionIndex(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  url: string = INDEX_URL,
  timeoutMs: number = INDEX_TIMEOUT_MS,
): Promise<RegionIndex | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return parseRegionIndex(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
