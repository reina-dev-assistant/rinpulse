import { create } from "zustand";
import type { Project } from "@/model/types";
import { MAX_BODY_BYTES } from "./api";

export const LINK_KEY = "joyofit-studio:cloud-link";

/** The cloud project the open face belongs to, and the revision this browser last saw of it. */
export interface CloudLink {
  id: string;
  rev: number;
  name: string;
}

export type CloudStatus = "idle" | "saving" | "saved" | "error" | "conflict";

/** What the account allows: unknown until `cloudAccess` answered once. */
export type CloudAccessState = "unknown" | "signed-out" | "free" | "pro";

export interface PersistedLink {
  linked: CloudLink | null;
  autosave: boolean;
}

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem" | "removeItem">;

/** The saved link; anything that does not look like one is dropped (the editor then simply starts unlinked). */
export function readLink(storage: ReadableStorage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): PersistedLink {
  const none: PersistedLink = { linked: null, autosave: false };
  try {
    const raw = storage?.getItem(LINK_KEY);
    if (!raw) return none;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return none;
    const { id, rev, name, autosave } = value as Record<string, unknown>;
    const linked = typeof id === "string" && id && typeof rev === "number" && Number.isInteger(rev) && rev >= 1 ? { id, rev, name: typeof name === "string" ? name : "" } : null;
    return { linked, autosave: autosave === true };
  } catch {
    return none;
  }
}

export function writeLink(state: PersistedLink, storage: WritableStorage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): void {
  try {
    if (!storage) return;
    if (!state.linked && !state.autosave) storage.removeItem(LINK_KEY);
    else storage.setItem(LINK_KEY, JSON.stringify({ ...state.linked, autosave: state.autosave }));
  } catch {
    // Private mode or a full disk: the link lives on for this visit only.
  }
}

export interface CloudState {
  linked: CloudLink | null;
  status: CloudStatus;
  autosave: boolean;
  access: CloudAccessState;
  /**
   * The project as the cloud holds it (the editor's own object, plus its JSON for comparing by content). Memory only: after a
   * reload it is unknown, and the face counts as changed.
   */
  baseline: { project: Project; json: string } | null;
  /** The server's body limit in bytes, as its last list answered. */
  maxBytes: number;
  /** When the cloud copy moved on (`status === "conflict"`): what the server reported. */
  conflict: { rev: number; updatedAt: number } | null;

  link: (link: CloudLink, project: Project) => void;
  /** Same face, new revision or name (a rename): the baseline stays. */
  relink: (link: CloudLink) => void;
  unlink: () => void;
  setStatus: (status: CloudStatus) => void;
  setAutosave: (on: boolean) => void;
  setAccess: (access: CloudAccessState) => void;
  setConflict: (conflict: { rev: number; updatedAt: number } | null) => void;
  setMaxBytes: (maxBytes: number) => void;
}

const initial = readLink();

export const useCloud = create<CloudState>((set, get) => {
  const persist = () => writeLink({ linked: get().linked, autosave: get().autosave });
  return {
    linked: initial.linked,
    status: "idle",
    autosave: initial.autosave,
    access: "unknown",
    baseline: null,
    maxBytes: MAX_BODY_BYTES,
    conflict: null,

    link: (link, project) => {
      set({ linked: link, baseline: { project, json: JSON.stringify(project) }, status: "saved", conflict: null });
      persist();
    },
    relink: (link) => {
      set({ linked: link });
      persist();
    },
    unlink: () => {
      set({ linked: null, baseline: null, status: "idle", conflict: null });
      persist();
    },
    setStatus: (status) => set({ status }),
    setAutosave: (autosave) => {
      set({ autosave });
      persist();
    },
    setAccess: (access) => set({ access }),
    setConflict: (conflict) => set({ conflict }),
    setMaxBytes: (maxBytes) => set({ maxBytes }),
  };
});

/** Whether the open project differs from what the cloud copy holds. Unknown counts as changed. */
export function isChanged(project: Project, baseline: CloudState["baseline"]): boolean {
  if (!baseline) return true;
  if (project === baseline.project) return false;
  return JSON.stringify(project) !== baseline.json;
}
