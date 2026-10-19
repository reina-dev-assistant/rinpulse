import { toast } from "sonner";
import { i18n } from "@/i18n";
import { useEditor } from "@/editor/store";
import { parseProjectFile } from "@/model/projectFile";
import type { Project } from "@/model/types";
import { CloudError, NAME_MAX, createCloudApi, type CloudAccess, type CloudMeta } from "./api";
import { createAutosave, type SaveOutcome } from "./autosave";
import { BODY_SLACK, buildCloudDocument } from "./document";
import { isChanged, useCloud } from "./store";
import { makeThumbnail } from "./thumbnail";

export const cloudApi = createCloudApi({ locale: () => i18n.language });

declare global {
  interface Window {
    /** Test hook: quiet time before the cloud autosave writes, in ms. */
    __STUDIO_CLOUD_AUTOSAVE_MS?: number;
  }
}

/** Quiet time after the last edit before the autosave writes. */
const AUTOSAVE_MS = ((): number => {
  const hook = typeof window === "undefined" ? undefined : window.__STUDIO_CLOUD_AUTOSAVE_MS;
  return typeof hook === "number" && hook >= 0 ? hook : 4000;
})();

const AUTOSAVE_TOAST = "cloud-autosave";

/** One cloud operation at a time: a manual save, the autosave, an open and a conflict choice never interleave their revisions. */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

/** Asks the account what it may do, remembers the answer, and returns it. */
export async function refreshAccess(): Promise<CloudAccess> {
  const access = await cloudApi.access();
  useCloud.getState().setAccess(access.state === "signed-out" ? "signed-out" : access.unlocked ? "pro" : "free");
  return access;
}

/** The project's name as the cloud stores it: trimmed, never empty, within the server's limit. */
export function cloudName(project: Project): string {
  return (project.name.trim() || i18n.t("editor:defaults.project")).slice(0, NAME_MAX);
}

/** A failed write moves the account state along: a lapsed Pro or a lost session is learned here. */
function noteFailure(error: unknown): void {
  const cloud = useCloud.getState();
  if (error instanceof CloudError) {
    if (error.kind === "paywall") cloud.setAccess("free");
    else if (error.kind === "unauthorized") cloud.setAccess("signed-out");
    if (error.kind === "rev_conflict") {
      cloud.setConflict({ rev: error.rev ?? 0, updatedAt: error.updatedAt ?? 0 });
      cloud.setStatus("conflict");
      return;
    }
    if (error.kind === "not_found") {
      // Deleted elsewhere: nothing to update any more, the face can be saved as a new project.
      cloud.unlink();
      cloud.setStatus("error");
      return;
    }
  }
  cloud.setStatus("error");
}

export interface SaveResult {
  meta: CloudMeta;
  /** Large images were re-encoded smaller in the cloud copy to fit the size limit. */
  shrunk: boolean;
}

/**
 * Saves the open project: `update` overwrites the linked cloud project (with the revision held), `new` creates one. The face
 * keeps being editable meanwhile: what is uploaded is the project as it was when the save began, and later edits stay "changed".
 * Throws a `CloudError` after recording the failure in the status.
 */
export function saveProject(mode: "update" | "new"): Promise<SaveResult> {
  return exclusive(async () => {
    const cloud = useCloud.getState();
    const link = mode === "update" ? cloud.linked : null;
    const editor = useEditor.getState();
    const project = editor.project;
    cloud.setStatus("saving");
    try {
      const limit = cloud.maxBytes;
      const [{ document, shrunk }, thumb] = await Promise.all([buildCloudDocument(project, limit - BODY_SLACK), makeThumbnail(project, editor.sim)]);
      const body = { name: cloudName(project), thumb: thumb ?? undefined, document };
      const meta = link ? await cloudApi.update(link.id, { rev: link.rev, ...body }, limit) : await cloudApi.create(body, limit);
      useCloud.getState().link({ id: meta.id, rev: meta.rev, name: meta.name }, project);
      autosave.resume();
      return { meta, shrunk };
    } catch (error) {
      noteFailure(error);
      throw error;
    }
  });
}

/** Renames a cloud project. When it is the linked one, the face takes the new name too so the next save does not undo it. */
export function renameProject(meta: CloudMeta, name: string): Promise<CloudMeta> {
  return exclusive(async () => {
    const renamed = await cloudApi.update(meta.id, { rev: meta.rev, name });
    const cloud = useCloud.getState();
    if (cloud.linked?.id === meta.id) {
      const baseline = cloud.baseline;
      const open = useEditor.getState().project;
      cloud.relink({ id: meta.id, rev: renamed.rev, name: renamed.name });
      // The face is unchanged apart from its name; the baseline follows so a clean face stays clean.
      if (open.name !== renamed.name) {
        useEditor.getState().patchProject({ name: renamed.name });
        if (baseline && !isChanged(open, baseline)) cloud.link({ id: meta.id, rev: renamed.rev, name: renamed.name }, useEditor.getState().project);
      }
    }
    return renamed;
  });
}

/** Loads a cloud project into the editor and links the editor to it. Throws `CloudError` or `ProjectFileError`. */
export function openProject(id: string): Promise<CloudMeta> {
  return exclusive(async () => {
    const remote = await cloudApi.get(id);
    const project = await parseProjectFile(JSON.stringify(remote.document));
    useEditor.getState().loadProject(project);
    useCloud.getState().link({ id: remote.id, rev: remote.rev, name: remote.name }, useEditor.getState().project);
    autosave.resume();
    return remote;
  });
}

/** Deletes a cloud project; the face stays open and is simply no longer linked when it was the one deleted. */
export function deleteProject(id: string): Promise<void> {
  return exclusive(async () => {
    await cloudApi.remove(id);
    if (useCloud.getState().linked?.id === id) useCloud.getState().unlink();
  });
}

/** Conflict choice "keep both": the local face becomes a new project named `<name> (copy)`, the cloud copy stays untouched. */
export function saveCopy(): Promise<SaveResult> {
  return exclusive(async () => {
    const cloud = useCloud.getState();
    cloud.setStatus("saving");
    const editor = useEditor.getState();
    const snapshot = editor.project;
    const base = cloudName(snapshot);
    const suffix = ` ${i18n.t("cloud:conflict.copySuffix")}`;
    const name = `${base.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    const named: Project = { ...snapshot, name };
    try {
      const limit = cloud.maxBytes;
      const [{ document, shrunk }, thumb] = await Promise.all([buildCloudDocument(named, limit - BODY_SLACK), makeThumbnail(named, editor.sim)]);
      const meta = await cloudApi.create({ name, thumb: thumb ?? undefined, document }, limit);
      // The face carries the copy's name from now on, so the next save does not rename the copy back.
      useEditor.getState().patchProject({ name });
      useCloud.getState().link({ id: meta.id, rev: meta.rev, name: meta.name }, named);
      autosave.resume();
      return { meta, shrunk };
    } catch (error) {
      noteFailure(error);
      throw error;
    }
  });
}

/** Conflict choice "load the cloud version": the local edits give way (they stay one undo away), the cloud copy is relinked. */
export function loadCloudVersion(): Promise<CloudMeta> {
  const id = useCloud.getState().linked?.id;
  if (!id) return Promise.reject(new CloudError("not_found", 404));
  return openProject(id);
}

/**
 * The autosave write: only when there is something to write and the account may. Reports to the scheduler how it went;
 * a failure shows once as a toast that the next success clears.
 */
async function autosaveWrite(): Promise<SaveOutcome> {
  try {
    const cloud = useCloud.getState();
    if (!cloud.autosave || !cloud.linked || cloud.status === "conflict") return "ok";
    if (cloud.access === "unknown") await refreshAccess();
    const { access, baseline } = useCloud.getState();
    if (access !== "pro") return "ok";
    if (!isChanged(useEditor.getState().project, baseline)) return "ok";
    await saveProject("update");
    toast.dismiss(AUTOSAVE_TOAST);
    return "ok";
  } catch (error) {
    if (error instanceof CloudError && error.kind === "rev_conflict") return "conflict";
    // A conflict raised elsewhere (the shared status) also stops the scheduler.
    if (useCloud.getState().status === "conflict") return "conflict";
    if (useCloud.getState().status !== "error") useCloud.getState().setStatus("error");
    toast.error(i18n.t("cloud:toast.autosaveFailed"), { id: AUTOSAVE_TOAST, description: i18n.t("cloud:toast.autosaveFailedBody") });
    return "error";
  }
}

const autosave = createAutosave({ delayMs: AUTOSAVE_MS, save: autosaveWrite });

/**
 * Wires the editor to the cloud autosave: every edit of a linked face counts down to one write. Called once from the app
 * root. `onConflict` hears the transition into the conflict state so the UI can offer the choices.
 */
export function startCloudSync(onConflict: () => void): () => void {
  const stopEditor = useEditor.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    const cloud = useCloud.getState();
    if (cloud.autosave && cloud.linked && cloud.access !== "free" && cloud.access !== "signed-out") autosave.touch();
  });
  const stopCloud = useCloud.subscribe((state, prev) => {
    if (state.status === "conflict" && prev.status !== "conflict") {
      toast.dismiss(AUTOSAVE_TOAST);
      onConflict();
    }
    // The switch turned on with edits already waiting: write them without needing another edit.
    if (state.autosave && !prev.autosave && state.linked && isChanged(useEditor.getState().project, state.baseline)) autosave.touch();
    if (!state.autosave && prev.autosave) autosave.cancel();
  });
  return () => {
    stopEditor();
    stopCloud();
    autosave.cancel();
  };
}
