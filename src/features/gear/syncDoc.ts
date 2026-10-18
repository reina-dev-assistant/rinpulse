import { EMPTY_GEAR_DOC, mergeGearDocs, sameGearDoc, type GearDoc } from './model';

/** The server's answer to `GET /v1/gear`. */
export interface RemoteGear {
  rev: number;
  doc: GearDoc | null;
}

/**
 * What may go up while `detachedAt` is set (`cloud_state.detached_at`, ms): this phone's data was kept apart from the account
 * that signed in afterwards, so nothing that is not newer than the detach is sent. The cloud overwrites the whole document,
 * so a held-back record takes the cloud's own version (the cloud keeps it) or is left out when the cloud has none.
 */
export function withholdDetached(merged: GearDoc, remote: GearDoc | null, detachedAt: number | null): GearDoc {
  if (detachedAt === null) return merged;
  const held = <T extends { updatedAt: number }>(items: T[], theirs: readonly T[] | undefined, key: (item: T) => string | number): T[] => {
    const cloud = new Map((theirs ?? []).map((item) => [key(item), item]));
    return items.flatMap((item) => {
      if (item.updatedAt > detachedAt) return [item];
      const kept = cloud.get(key(item));
      return kept ? [kept] : [];
    });
  };
  const gear = held(merged.gear, remote?.gear, (g) => g.id);
  const sent = new Set(gear.map((g) => g.id));
  // A default or a tick made after the detach that points at gear that stayed behind would send an id the account never sees.
  const reachable = <T extends { gearId: string | null }>(items: T[]): T[] => items.filter((item) => item.gearId === null || sent.has(item.gearId));
  return {
    version: 1,
    gear,
    defaults: reachable(held(merged.defaults, remote?.defaults, (d) => d.sport)),
    assignments: reachable(held(merged.assignments, remote?.assignments, (a) => a.workoutStart)),
  };
}

/** The four things a gear sync does to the outside, so the loop below runs under `bun test` without a database or a server. */
export interface GearSyncIo {
  /** `cloud_state.detached_at`, or null when this phone's data was never kept apart from an account. */
  detachedAt: () => Promise<number | null>;
  fetchRemote: () => Promise<RemoteGear>;
  /** `PUT /v1/gear`: `conflict` is a stale `baseRev` (409), `locked` an account that is not Pro (402). Other failures throw. */
  putRemote: (baseRev: number, doc: GearDoc) => Promise<'ok' | 'conflict' | 'locked'>;
  readLocal: () => Promise<GearDoc>;
  writeLocal: (doc: GearDoc) => Promise<void>;
}

const MAX_ATTEMPTS = 3;

/**
 * Brings the phone and the cloud copy of the gear to one document: merge per record (newest edit wins), store what changed
 * here, then upload the result unless the cloud already has exactly it. A stale `baseRev` (another phone wrote in between)
 * is merged again with what is there now. Returns what happened. An account that is not Pro only reads: it still gets the
 * gear of a new phone, but its changes stay local. After "keep separate" (`detachedAt`) the upload leaves out what is not
 * newer than the detach, see {@link withholdDetached}.
 */
export async function syncGearDoc(io: GearSyncIo): Promise<'unchanged' | 'uploaded' | 'downloaded' | 'local-only'> {
  let changedHere = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remote = await io.fetchRemote();
    const local = await io.readLocal();
    const merged = mergeGearDocs(local, remote.doc ?? EMPTY_GEAR_DOC);
    if (!sameGearDoc(merged, local)) {
      await io.writeLocal(merged);
      changedHere = true;
    }
    const upload = withholdDetached(merged, remote.doc, await io.detachedAt());
    if (remote.doc === null ? upload.gear.length === 0 && upload.defaults.length === 0 && upload.assignments.length === 0 : sameGearDoc(upload, remote.doc)) {
      return changedHere ? 'downloaded' : 'unchanged';
    }
    const outcome = await io.putRemote(remote.rev, upload);
    if (outcome === 'ok') return 'uploaded';
    if (outcome === 'locked') return changedHere ? 'downloaded' : 'local-only';
  }
  throw new Error('gear changed on another phone too often'); // i18n-ok: logged, never shown
}
