import { EMPTY_COACH_DOC, type CoachDoc } from './doc';
import { mergeCoachDocs, sameCoachDoc } from './merge';

/** The answer of JoyoRogo's `coach.getDoc`. */
export interface RemoteCoach {
  rev: number;
  doc: CoachDoc | null;
}

/** `coach.putDoc`: `conflict` is a stale `baseRev`, `locked` an account that is not Pro. */
export type PutResult = { status: 'ok'; rev: number } | { status: 'conflict'; rev: number; doc: CoachDoc | null } | { status: 'locked' };

export interface CoachSyncIo {
  /** `cloud_state.detached_at` (ms), or null when this phone's data was never kept apart from an account. */
  detachedAt: () => Promise<number | null>;
  fetchRemote: () => Promise<RemoteCoach>;
  putRemote: (baseRev: number, doc: CoachDoc) => Promise<PutResult>;
  readLocal: () => Promise<CoachDoc>;
  writeLocal: (doc: CoachDoc) => Promise<void>;
}

const MAX_ATTEMPTS = 3;

const isEmpty = (doc: CoachDoc): boolean => doc.plan === null && doc.planUpdatedAt === 0 && Object.keys(doc.done).length === 0 && Object.keys(doc.logs).length === 0;

/** The time of the newest change in the document: the plan (or its end), a finished session, a strength log. */
export function newestCoachChange(doc: CoachDoc): number {
  let newest = doc.planUpdatedAt;
  for (const entry of Object.values(doc.done)) newest = Math.max(newest, entry.at);
  for (const entry of Object.values(doc.logs)) newest = Math.max(newest, entry.at);
  return newest;
}

/**
 * Brings the phone and the cloud copy of the coach document to one document: merge (`mergeCoachDocs`), store what
 * changed here, then upload unless the cloud already has exactly the result. A stale `baseRev` (another phone wrote in
 * between) is merged again with what is there now. An account that is not Pro only reads: a new phone still gets the plan,
 * but changes stay local. After "keep separate" (`detachedAt`) a document whose newest change is not newer than the detach is
 * never uploaded: it is the previous account's plan, and the cloud copy is one whole document that the upload would replace.
 */
export async function syncCoachDoc(io: CoachSyncIo): Promise<'unchanged' | 'uploaded' | 'downloaded' | 'local-only'> {
  let changedHere = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remote = await io.fetchRemote();
    const local = await io.readLocal();
    const merged = mergeCoachDocs(local, remote.doc ?? EMPTY_COACH_DOC);
    if (!sameCoachDoc(merged, local)) {
      await io.writeLocal(merged);
      changedHere = true;
    }
    if (remote.doc === null ? isEmpty(merged) : sameCoachDoc(merged, remote.doc)) return changedHere ? 'downloaded' : 'unchanged';
    const detachedAt = await io.detachedAt();
    if (detachedAt !== null && newestCoachChange(merged) <= detachedAt) return changedHere ? 'downloaded' : 'local-only';
    const outcome = await io.putRemote(remote.rev, merged);
    if (outcome.status === 'ok') return 'uploaded';
    if (outcome.status === 'locked') return changedHere ? 'downloaded' : 'local-only';
  }
  throw new Error('coach plan changed on another phone too often'); // i18n-ok: logged, never shown
}

