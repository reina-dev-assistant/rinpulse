/** One face of the account's web library, as `GET /v1/watchfaces` returns it (`createdAt` is normalised to unix seconds by {@link parseWebFaces}). */
export interface WebFace {
  readonly id: string;
  readonly name: string;
  readonly filename: string;
  /** Bytes. */
  readonly size: number;
  readonly sha256: string;
  /** Unix seconds. */
  readonly createdAt: number;
}

export type WebLibraryState =
  | 'notConfigured'
  | 'signedOut'
  | 'loading'
  | 'error'
  | 'empty'
  | 'ready';

export type WebLibraryLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'loaded'; readonly faces: readonly WebFace[] };

/** Converts a server timestamp (unix seconds, unix milliseconds, or an ISO string) to unix seconds; null when unusable. */
export function toUnixSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

/** Keeps the well-formed rows of the `watchfaces` array (drops anything without an id and a usable name), newest first. */
export function parseWebFaces(body: unknown): WebFace[] {
  const rows = (body as { watchfaces?: unknown } | null)?.watchfaces;
  if (!Array.isArray(rows)) return [];
  const faces: WebFace[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id === '') continue;
    const filename = typeof r.filename === 'string' ? r.filename : '';
    const name = typeof r.name === 'string' && r.name.trim() !== '' ? r.name.trim() : filename.replace(/\.hwt$/i, '');
    if (name === '') continue;
    faces.push({
      id: r.id,
      name,
      filename,
      size: typeof r.size === 'number' && Number.isFinite(r.size) && r.size >= 0 ? r.size : 0,
      sha256: typeof r.sha256 === 'string' ? r.sha256 : '',
      createdAt: toUnixSeconds(r.createdAt) ?? 0,
    });
  }
  return faces.sort((a, b) => b.createdAt - a.createdAt);
}

/** Which of the section's views to show. */
export function webLibraryState(input: {
  configured: boolean;
  signedIn: boolean;
  sessionPending: boolean;
  load: WebLibraryLoad;
}): WebLibraryState {
  if (!input.configured) return 'notConfigured';
  if (input.sessionPending) return 'loading';
  if (!input.signedIn) return 'signedOut';
  switch (input.load.status) {
    case 'idle':
    case 'loading':
      return 'loading';
    case 'error':
      return 'error';
    case 'loaded':
      return input.load.faces.length === 0 ? 'empty' : 'ready';
  }
}

/** "812 KB" / "1.4 MB": the size line of a row (decimal-free below 1 MB). */
export function formatFaceSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const norm = (s: string) => s.toLowerCase().trim();

/** The face is already on the watch: same name (exact, case-insensitive) as an installed face. */
export function isWebFaceInstalled(face: Pick<WebFace, 'name'>, installed: readonly { name: string }[] | undefined): boolean {
  if (!installed || installed.length === 0) return false;
  const target = norm(face.name);
  return installed.some((f) => norm(f.name) === target);
}

export type WebInstallBlock = 'notConnected' | 'busy' | 'installed' | null;

/** Why the install button of a row is disabled, null when it can run. */
export function webInstallBlock(input: {
  connected: boolean;
  idle: boolean;
  installed: boolean;
}): WebInstallBlock {
  if (input.installed) return 'installed';
  if (!input.connected) return 'notConnected';
  if (!input.idle) return 'busy';
  return null;
}
