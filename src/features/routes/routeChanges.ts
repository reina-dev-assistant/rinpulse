/**
 * Who wants to know that a saved route was created, renamed or deleted: the cloud sync (`src/cloud/contentSync.ts`) stamps the
 * edit. Kept apart from `routeStore.ts` (which needs the file system) so the sync can listen without importing it.
 */
type ChangeListener = (id: string) => void;

const listeners = new Set<ChangeListener>();

/** Calls `listener` with the id of every route the store saved, renamed or deleted, after the write. Returns the function that stops listening. */
export function onRouteChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function notifyRouteChange(id: string): void {
  for (const listener of listeners) listener(id);
}
