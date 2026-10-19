import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, CloudUpload, LoaderCircle, LogIn, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { intlLocale } from "@/i18n";
import { useEditor } from "@/editor/store";
import { ProjectFileError } from "@/model/projectFile";
import { Button, buttonVariants } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Switch } from "@/ui/switch";
import { cn } from "@/ui/utils";
import { CloudError, type CloudList, type CloudMeta } from "./api";
import { LOGIN_PATH, PRICING_PATH, formatBytes, webUrl } from "./format";
import { useCloudChanged } from "./hooks";
import { ProjectRows } from "./ProjectRows";
import { isPristine } from "./pristine";
import { isChanged, useCloud } from "./store";
import { deleteProject, loadCloudVersion, openProject, refreshAccess, renameProject, saveCopy, saveProject, cloudApi } from "./sync";

type Tone = "error" | "info";

function Notice({ tone, icon, children, testId }: { tone: Tone; icon?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-testid={testId}
      className={cn("flex gap-2.5 rounded-2xl p-3 text-[0.8125rem] text-foreground", tone === "error" ? "bg-destructive/10" : "bg-muted")}
    >
      {icon ?? <TriangleAlert className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-destructive" : "text-muted-foreground")} />}
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

type Busy = { kind: "save" | "new" | "copy" | "load-cloud" } | { kind: "open" | "delete" | "rename"; id: string } | null;

export function CloudDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("cloud");
  const locale = intlLocale();
  const access = useCloud((s) => s.access);
  const linked = useCloud((s) => s.linked);
  const status = useCloud((s) => s.status);
  const autosave = useCloud((s) => s.autosave);
  const setAutosave = useCloud((s) => s.setAutosave);
  const changed = useCloudChanged();

  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [failure, setFailure] = useState<unknown>(null);
  const [list, setList] = useState<CloudList | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<CloudMeta | null>(null);
  const run = useRef(0);

  const errorText = useCallback(
    (error: unknown): string => {
      if (error instanceof ProjectFileError) return error.message;
      if (!(error instanceof CloudError)) return t("error.server");
      switch (error.kind) {
        case "too_large": {
          const max = formatBytes(error.maxBytes ?? 0, locale);
          return error.size === undefined ? t("error.tooLargeServer", { max }) : t("error.tooLarge", { size: formatBytes(error.size, locale), max });
        }
        case "library_full":
          return t("error.libraryFull", { max: error.max ?? list?.max ?? 100 });
        case "paywall":
          return t("error.paywall");
        case "unauthorized":
          return t("error.unauthorized");
        case "rev_conflict":
          return t("error.revConflict");
        case "not_found":
          return t("error.notFound");
        case "unavailable":
          return t("error.unavailable");
        case "network":
          return t("error.network");
        default:
          return t("error.server");
      }
    },
    [t, locale, list?.max],
  );

  /** The list alone, without the loading state: after a save, a rename, a delete. */
  const reloadList = useCallback(async () => {
    try {
      const next = await cloudApi.list();
      useCloud.getState().setMaxBytes(next.maxBytes);
      setList(next);
      setListError(null);
    } catch (error) {
      if (error instanceof CloudError && error.kind === "unauthorized") useCloud.getState().setAccess("signed-out");
      else setListError(error);
    }
  }, []);

  const load = useCallback(async () => {
    const id = ++run.current;
    setPhase("loading");
    setMessage(null);
    setConfirmOpen(null);
    const [who, projects] = await Promise.allSettled([refreshAccess(), cloudApi.list()]);
    if (id !== run.current) return;
    if (who.status === "rejected") {
      setFailure(who.reason);
      setPhase("failed");
      return;
    }
    if (who.value.state === "signed-out") {
      setList(null);
      setListError(null);
    } else if (projects.status === "fulfilled") {
      useCloud.getState().setMaxBytes(projects.value.maxBytes);
      setList(projects.value);
      setListError(null);
    } else if (projects.reason instanceof CloudError && projects.reason.kind === "unauthorized") {
      useCloud.getState().setAccess("signed-out");
    } else {
      setList(null);
      setListError(projects.reason);
    }
    setPhase("ready");
  }, []);

  useEffect(() => {
    if (open) void load();
    else run.current++;
  }, [open, load]);

  const fail = (error: unknown) => {
    if (error instanceof CloudError && error.kind === "rev_conflict" && useCloud.getState().status === "conflict") return;
    setMessage({ tone: "error", text: errorText(error) });
  };

  const save = async (mode: "update" | "new") => {
    setMessage(null);
    setBusy({ kind: mode === "update" ? "save" : "new" });
    try {
      const { meta, shrunk } = await saveProject(mode);
      toast.success(t("toast.saved", { name: meta.name }));
      if (shrunk) setMessage({ tone: "info", text: t("notice.shrunk") });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
    void reloadList();
  };

  const keepBoth = async () => {
    setMessage(null);
    setBusy({ kind: "copy" });
    try {
      const { meta, shrunk } = await saveCopy();
      toast.success(t("toast.savedCopy", { name: meta.name }));
      if (shrunk) setMessage({ tone: "info", text: t("notice.shrunk") });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
    void reloadList();
  };

  const useCloudVersion = async () => {
    setMessage(null);
    setBusy({ kind: "load-cloud" });
    try {
      const meta = await loadCloudVersion();
      toast.success(t("toast.opened", { name: meta.name }));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
    void reloadList();
  };

  const doOpen = async (meta: CloudMeta) => {
    setMessage(null);
    setConfirmOpen(null);
    setBusy({ kind: "open", id: meta.id });
    try {
      const opened = await openProject(meta.id);
      toast.success(t("toast.opened", { name: opened.name }));
      onClose();
    } catch (error) {
      fail(error);
      if (error instanceof CloudError && error.kind === "not_found") void reloadList();
    } finally {
      setBusy(null);
    }
  };

  /** Opening replaces the face on the stage: ask first unless nothing would be lost (linked and saved, or still the blank start face). */
  const requestOpen = (meta: CloudMeta) => {
    setMessage(null);
    const cloud = useCloud.getState();
    const project = useEditor.getState().project;
    const loses = cloud.linked ? isChanged(project, cloud.baseline) : !isPristine(project);
    if (loses) setConfirmOpen(meta);
    else void doOpen(meta);
  };

  const rename = async (meta: CloudMeta, name: string) => {
    setMessage(null);
    setBusy({ kind: "rename", id: meta.id });
    try {
      await renameProject(meta, name);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
    void reloadList();
  };

  const remove = async (meta: CloudMeta) => {
    setMessage(null);
    setBusy({ kind: "delete", id: meta.id });
    try {
      await deleteProject(meta.id);
      toast.success(t("toast.deleted", { name: meta.name }));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
    void reloadList();
  };

  const pro = access === "pro";
  const working = busy !== null;
  // The choices stay on screen while the chosen one runs.
  const conflict = linked !== null && (status === "conflict" || busy?.kind === "copy" || busy?.kind === "load-cloud");
  const stateKey = status === "saving" ? "saving" : status === "error" ? "error" : changed ? "changed" : "saved";

  return (
    <Dialog open={open} onClose={onClose} title={t("title")} description={t("description")} className="max-w-xl" testId="cloud-dialog">
      <div className="space-y-4 pt-1 pb-2" data-access={phase === "ready" ? access : phase}>
        {phase === "loading" && (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status" data-testid="cloud-loading">
            <LoaderCircle className="size-4 animate-spin" />
            {t("loading")}
          </p>
        )}

        {phase === "failed" && (
          <div className="space-y-3 py-2" data-testid="cloud-failed">
            <Notice tone="error">{errorText(failure)}</Notice>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t("retry")}
            </Button>
          </div>
        )}

        {phase === "ready" && access === "signed-out" && (
          <section className="space-y-3 rounded-2xl bg-muted/60 p-4" data-testid="cloud-signed-out">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Cloud className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold">{t("signedOut.title")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("signedOut.body")}</p>
              </div>
            </div>
            <a href={webUrl(LOGIN_PATH)} data-testid="cloud-login" className={cn(buttonVariants({ size: "sm" }), "w-full sm:w-auto")}>
              <LogIn />
              {t("signedOut.action")}
            </a>
            <p className="text-[0.8125rem] text-muted-foreground">{t("localStillWorks")}</p>
          </section>
        )}

        {phase === "ready" && access === "free" && (
          <section className="space-y-3 rounded-2xl bg-muted/60 p-4" data-testid="cloud-free">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold">{t("free.title")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("free.body")}</p>
              </div>
            </div>
            <a href={webUrl(PRICING_PATH)} data-testid="cloud-pricing" className={cn(buttonVariants({ size: "sm" }), "w-full sm:w-auto")}>
              {t("free.action")}
            </a>
            <p className="text-[0.8125rem] text-muted-foreground">{t("localStillWorks")}</p>
          </section>
        )}

        {phase === "ready" && (access === "pro" || access === "free") && (
          <>
            {linked && (
              <section className="space-y-3 rounded-2xl bg-muted/60 p-3" data-testid="cloud-linked">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{t("linked.label")}</p>
                    <p className="truncate text-sm font-bold" data-testid="cloud-linked-name">
                      {linked.name}
                    </p>
                  </div>
                  <span
                    data-testid="cloud-status"
                    data-state={conflict ? "conflict" : stateKey}
                    className="shrink-0 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                  >
                    {conflict ? t("status.conflict") : t(`status.${stateKey}`)}
                  </span>
                </div>
                {pro && (
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block font-semibold">{t("autosave.label")}</span>
                      <span className="block text-[0.8125rem] text-muted-foreground">{t("autosave.hint")}</span>
                    </span>
                    <Switch checked={autosave} onCheckedChange={setAutosave} label={t("autosave.label")} />
                  </label>
                )}
              </section>
            )}

            {conflict && (
              <section className="space-y-3 rounded-2xl bg-warning-soft p-4 text-foreground" role="alertdialog" aria-labelledby="cloud-conflict-title" data-testid="cloud-conflict">
                <div className="flex gap-2.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div className="min-w-0">
                    <h3 id="cloud-conflict-title" className="text-sm font-bold">
                      {t("conflict.title")}
                    </h3>
                    <p className="mt-1 text-[0.8125rem]">{t("conflict.body")}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button size="sm" disabled={working || !pro} onClick={() => void keepBoth()} data-testid="cloud-keep-both">
                    {busy?.kind === "copy" && <LoaderCircle className="animate-spin" />}
                    {t("conflict.keepBoth")}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={working} onClick={() => void useCloudVersion()} data-testid="cloud-load-cloud">
                    {busy?.kind === "load-cloud" && <LoaderCircle className="animate-spin" />}
                    {t("conflict.loadCloud")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={working} onClick={onClose} data-testid="cloud-conflict-cancel">
                    {t("conflict.cancel")}
                  </Button>
                </div>
                <ul className="list-disc space-y-0.5 pl-5 text-[0.75rem] text-muted-foreground">
                  <li>{t("conflict.keepBothHint")}</li>
                  <li>{t("conflict.loadCloudHint")}</li>
                </ul>
              </section>
            )}

            {!conflict && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {linked && (
                  <Button disabled={!pro || working} onClick={() => void save("update")} data-testid="cloud-save">
                    {busy?.kind === "save" ? <LoaderCircle className="animate-spin" /> : <CloudUpload />}
                    {t("save.update")}
                  </Button>
                )}
                <Button variant={linked ? "secondary" : "default"} disabled={!pro || working} onClick={() => void save("new")} data-testid="cloud-save-new">
                  {busy?.kind === "new" ? <LoaderCircle className="animate-spin" /> : <CloudUpload />}
                  {linked ? t("save.asNew") : t("save.new")}
                </Button>
              </div>
            )}
          </>
        )}

        {message && (
          <Notice tone={message.tone} testId="cloud-message">
            {message.text}
          </Notice>
        )}

        {confirmOpen && (
          <section className="space-y-3 rounded-2xl bg-warning-soft p-4 text-foreground" role="alertdialog" aria-labelledby="cloud-replace-title" data-testid="cloud-replace">
            <div className="flex gap-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="min-w-0">
                <h3 id="cloud-replace-title" className="text-sm font-bold">
                  {t("replace.title")}
                </h3>
                <p className="mt-1 text-[0.8125rem] break-words">{t("replace.body", { name: confirmOpen.name })}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void doOpen(confirmOpen)} data-testid="cloud-replace-confirm">
                {t("replace.confirm")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(null)} data-testid="cloud-replace-cancel">
                {t("replace.cancel")}
              </Button>
            </div>
          </section>
        )}

        {phase === "ready" && access !== "signed-out" && (
          <ProjectRows
            list={list}
            listError={listError ? errorText(listError) : null}
            onRetry={() => void reloadList()}
            linkedId={linked?.id ?? null}
            canWrite={pro}
            busyId={busy && "id" in busy ? busy.id : null}
            disabled={working}
            onOpen={requestOpen}
            onRename={(meta, name) => void rename(meta, name)}
            onDelete={(meta) => void remove(meta)}
          />
        )}
      </div>
    </Dialog>
  );
}
