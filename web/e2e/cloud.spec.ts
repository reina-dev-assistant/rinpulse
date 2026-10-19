import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

/**
 * Cloud projects against a mocked API: an in-memory copy of the server contract (rev logic, limits, Pro gate, CORS) answers
 * `**\/api/fit/studio/projects**` and `**\/rpc/fitness/cloudAccess`, so nothing leaves the machine.
 */

type Session = "out" | "free" | "pro";

interface Stored {
  id: string;
  name: string;
  rev: number;
  size: number;
  createdAt: number;
  updatedAt: number;
  thumb: string | null;
  document: unknown;
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  contentType: string | null;
  locale: string | null;
}

class MockCloud {
  session: Session;
  maxBytes = 5 * 1024 * 1024;
  max = 100;
  projects = new Map<string, Stored>();
  calls: Call[] = [];
  /** Outage answers for the next project calls of a method, taken in order, before the normal logic. */
  private failures: Array<{ method: string; status: number }> = [];
  private clock = 1_700_000_000_000;
  private seq = 0;

  constructor(session: Session) {
    this.session = session;
  }

  private tick(): number {
    this.clock += 1000;
    return this.clock;
  }

  failNext(method: string, status: number): void {
    this.failures.push({ method, status });
  }

  seed(name: string, document: unknown, thumb: string | null = null): Stored {
    const now = this.tick();
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    const stored: Stored = { id, name, rev: 1, size: JSON.stringify(document).length, createdAt: now, updatedAt: now, thumb, document };
    this.projects.set(id, stored);
    return stored;
  }

  /** Another device saved: the revision moves on and (optionally) the document changes. */
  externalEdit(id: string, patch: { name?: string; document?: unknown } = {}): void {
    const stored = this.projects.get(id)!;
    stored.rev += 1;
    stored.updatedAt = this.tick();
    if (patch.name) stored.name = patch.name;
    if (patch.document) stored.document = patch.document;
  }

  byName(name: string): Stored {
    const found = [...this.projects.values()].find((p) => p.name === name);
    if (!found) throw new Error(`no cloud project named ${name}`);
    return found;
  }

  writes(method: string): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  private meta(p: Stored) {
    const { document: _document, ...meta } = p;
    return meta;
  }

  private cors(request: Request): Record<string, string> {
    return {
      "access-control-allow-origin": request.headers().origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type, x-locale, accept",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      vary: "origin",
    };
  }

  private reply(route: Route, status: number, body: unknown): Promise<void> {
    return route.fulfill({ status, headers: { ...this.cors(route.request()), "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  async access(route: Route): Promise<void> {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: this.cors(route.request()) });
    if (this.session === "out") return this.reply(route, 401, { error: "unauthorized" });
    return this.reply(route, 200, { json: { unlocked: this.session === "pro", tier: this.session === "pro" ? "founder" : "free" } });
  }

  async projectsRoute(route: Route): Promise<void> {
    const request = route.request();
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: this.cors(request) });
    const url = new URL(request.url());
    const id = url.pathname.split("/").filter(Boolean).at(4) ?? null;
    const raw = request.postData();
    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    this.calls.push({ method, path: url.pathname, body, contentType: request.headers()["content-type"] ?? null, locale: request.headers()["x-locale"] ?? null });

    const failureAt = this.failures.findIndex((f) => f.method === method);
    if (failureAt >= 0) {
      const [failure] = this.failures.splice(failureAt, 1);
      return this.reply(route, failure!.status, { error: failure!.status === 503 ? "auth_unavailable" : "boom" });
    }
    if (this.session === "out") return this.reply(route, 401, { error: "unauthorized" });

    const write = method === "POST" || method === "PUT";
    if (write && this.session !== "pro") return this.reply(route, 402, { error: "founder_required", paywall: true });
    if (write && Buffer.byteLength(raw ?? "") > this.maxBytes) return this.reply(route, 413, { error: "too_large", maxBytes: this.maxBytes });

    if (!id) {
      if (method === "GET") {
        const projects = [...this.projects.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => this.meta(p));
        return this.reply(route, 200, { projects, max: this.max, maxBytes: this.maxBytes });
      }
      if (method === "POST") {
        if (this.projects.size >= this.max) return this.reply(route, 409, { error: "library_full", max: this.max });
        const name = String(body?.name ?? "").trim();
        if (!name || name.length > 80) return this.reply(route, 400, { error: "invalid" });
        const stored = this.seed(name, body?.document, (body?.thumb as string | null | undefined) ?? null);
        stored.size = Buffer.byteLength(JSON.stringify(body?.document));
        return this.reply(route, 201, this.meta(stored));
      }
      return this.reply(route, 405, { error: "method" });
    }

    const stored = this.projects.get(id);
    if (!stored) return this.reply(route, 404, { error: "not_found" });
    if (method === "GET") return this.reply(route, 200, { ...this.meta(stored), document: stored.document });
    if (method === "DELETE") {
      this.projects.delete(id);
      return this.reply(route, 200, { deleted: true });
    }
    if (method === "PUT") {
      if (body?.rev !== stored.rev) return this.reply(route, 409, { error: "rev_conflict", rev: stored.rev, updatedAt: stored.updatedAt });
      if (typeof body.name === "string") stored.name = body.name.trim();
      if (body.thumb !== undefined) stored.thumb = body.thumb as string | null;
      if (body.document !== undefined) {
        stored.document = body.document;
        stored.size = Buffer.byteLength(JSON.stringify(body.document));
      }
      stored.rev += 1;
      stored.updatedAt = this.tick();
      return this.reply(route, 200, this.meta(stored));
    }
    return this.reply(route, 405, { error: "method" });
  }
}

async function mock(page: Page, session: Session): Promise<MockCloud> {
  const cloud = new MockCloud(session);
  await page.route("**/rpc/fitness/cloudAccess", (route) => cloud.access(route));
  await page.route("**/api/fit/studio/projects**", (route) => cloud.projectsRoute(route));
  return cloud;
}

async function open(page: Page, options: { locale?: "en" | "id" | null; autosaveMs?: number } = {}): Promise<void> {
  const locale = options.locale === undefined ? "en" : options.locale;
  await page.addInitScript(
    ([choice, autosaveMs]) => {
      localStorage.setItem("joyofit-studio:help-seen", "1");
      if (choice && !sessionStorage.getItem("seeded")) {
        localStorage.setItem("jfit-locale", choice);
        sessionStorage.setItem("seeded", "1");
      }
      if (autosaveMs) (window as unknown as { __STUDIO_CLOUD_AUTOSAVE_MS: number }).__STUDIO_CLOUD_AUTOSAVE_MS = autosaveMs;
    },
    [locale ?? "", options.autosaveMs ?? 0] as const,
  );
  await page.goto("./");
  await expect(page.getByTestId("face-canvas")).toBeVisible();
}

async function openCloud(page: Page): Promise<void> {
  await page.getByTestId("open-cloud").click();
  await expect(page.getByTestId("cloud-dialog")).toBeVisible();
  await expect(page.getByTestId("cloud-loading")).toBeHidden();
}

async function closeCloud(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cloud-dialog")).toBeHidden();
}

async function rename(page: Page, name: string): Promise<void> {
  await page.getByTestId("face-name").fill(name);
}

/** The editor's project as the local autosave holds it, flushed now (null until something was edited). */
async function localProject(page: Page): Promise<unknown> {
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  return page.evaluate(() => JSON.parse(localStorage.getItem("joyofit-studio:project:v1")!));
}

/** A small face-like picture for a seeded project, as the thumbnails the app makes (JPEG data URL). */
function thumbFor(color: string): string {
  const canvas = createCanvas(102, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101a1d";
  ctx.fillRect(0, 0, 102, 120);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(51, 60, 34, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/jpeg", 0.6);
}

/** Seeds a cloud project holding a valid, empty face with the given name. */
function seedFace(cloud: MockCloud, name: string, color = "#58c4de"): Stored {
  return cloud.seed(name, { format: "joyofit-studio-project", project: { version: 1, name, author: "", elements: [] }, assets: {} }, thumbFor(color));
}

function link(page: Page): Promise<{ id: string; rev: number; name: string; autosave: boolean } | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("joyofit-studio:cloud-link");
    return raw ? JSON.parse(raw) : null;
  });
}

test.describe("signed out", () => {
  test("shows the sign-in prompt with the login link, and never calls the projects API", async ({ page }) => {
    const cloud = await mock(page, "out");
    await open(page);
    await page.getByTestId("open-cloud").click();
    const dialog = page.getByTestId("cloud-dialog");
    await expect(dialog.getByRole("heading", { name: "Cloud projects", level: 2 })).toBeVisible();
    const signedOut = page.getByTestId("cloud-signed-out");
    await expect(signedOut).toContainText("Sign in to save your projects to the cloud");
    await expect(signedOut).toContainText("Saving and opening JSON files still works");
    await expect(page.getByTestId("cloud-login")).toHaveAttribute("href", "https://app.fit.joyorogo.com/login?redirect=/studio/");
    await expect(page.getByTestId("cloud-save-new")).toHaveCount(0);
    await expect(page.getByTestId("cloud-count")).toHaveCount(0);
    // The access check ran; the list call from the same moment is allowed, but nothing was ever written.
    expect(cloud.writes("POST").concat(cloud.writes("PUT"), cloud.writes("DELETE"))).toEqual([]);
  });

  test("local JSON save and open keep working", async ({ page }) => {
    await mock(page, "out");
    await open(page);
    await rename(page, "Local only");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project JSON" }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.project\.json$/);
    const file = await readFile(await dl.path());
    expect(JSON.parse(file.toString()).project.name).toBe("Local only");

    await rename(page, "Changed after saving");
    await page.locator('input[type="file"][accept*="json"]').setInputFiles({ name: "x.project.json", mimeType: "application/json", buffer: file });
    await expect(page.getByTestId("face-name")).toHaveValue("Local only");
  });

  test("a network failure of the access check is a retryable error, not a logged-out prompt", async ({ page }) => {
    await page.route("**/rpc/fitness/cloudAccess", (route) => route.abort("failed"));
    await page.route("**/api/fit/studio/projects**", (route) => route.abort("failed"));
    await open(page);
    await page.getByTestId("open-cloud").click();
    await expect(page.getByTestId("cloud-failed")).toContainText("Can't connect");
    await expect(page.getByTestId("cloud-signed-out")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

test.describe("signed in without Pro", () => {
  test("shows the Pro prompt, keeps the saved list readable, and disables writing", async ({ page }) => {
    const cloud = await mock(page, "free");
    await open(page);
    seedFace(cloud, "From my Pro days");
    await openCloud(page);
    await expect(page.getByTestId("cloud-free")).toContainText("Cloud saving is for Pro");
    await expect(page.getByTestId("cloud-pricing")).toHaveAttribute("href", "https://app.fit.joyorogo.com/harga");
    await expect(page.getByTestId("cloud-save-new")).toBeDisabled();
    await expect(page.getByTestId("cloud-count")).toHaveText("1 of 100 projects");
    const row = page.getByTestId(`cloud-row-${cloud.byName("From my Pro days").id}`);
    await expect(row).toContainText("From my Pro days");
    await expect(row.getByRole("button", { name: /^Rename/ })).toBeDisabled();
    await expect(row.getByRole("button", { name: /^Open/ })).toBeEnabled();
    await expect(row.getByRole("button", { name: /^Delete/ })).toBeEnabled();
  });

  test("opening and deleting still work for a lapsed Pro", async ({ page }) => {
    const cloud = await mock(page, "free");
    await open(page);
    const first = seedFace(cloud, "Kept");
    const second = seedFace(cloud, "Dropped");
    await openCloud(page);
    await page.getByTestId(`cloud-delete-${second.id}`).click();
    await page.getByTestId(`cloud-delete-yes-${second.id}`).click();
    await expect(page.getByTestId(`cloud-row-${second.id}`)).toHaveCount(0);
    await expect(page.getByTestId("cloud-count")).toHaveText("1 of 100 projects");
    await page.getByTestId(`cloud-open-${first.id}`).click();
    await expect(page.getByTestId("cloud-dialog")).toBeHidden();
    await expect(page.getByTestId("face-name")).toHaveValue("Kept");
  });
});

test.describe("Pro", () => {
  test("saves a new project with a thumbnail and lists it", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    await rename(page, "Alpha");
    await openCloud(page);
    await expect(page.getByTestId("cloud-empty")).toBeVisible();
    await expect(page.getByTestId("cloud-count")).toHaveText("0 of 100 projects");
    await page.getByTestId("cloud-save-new").click();

    await expect.poll(() => cloud.projects.size).toBe(1);
    const stored = cloud.byName("Alpha");
    const post = cloud.writes("POST")[0]!;
    expect(post.contentType).toBe("application/json");
    expect(post.locale).toBe("en");
    expect(post.body).toMatchObject({ name: "Alpha" });
    expect((post.body!.document as { format: string }).format).toBe("joyofit-studio-project");
    const thumb = post.body!.thumb as string;
    expect(thumb).toMatch(/^data:image\/(jpeg|webp|png);base64,/);
    expect(thumb.length).toBeLessThanOrEqual(12 * 1024);

    const row = page.getByTestId(`cloud-row-${stored.id}`);
    await expect(row).toContainText("Alpha");
    await expect(row.locator("img")).toHaveAttribute("src", thumb);
    await expect(row).toHaveAttribute("data-linked", "true");
    await expect(page.getByTestId("cloud-count")).toHaveText("1 of 100 projects");
    await expect(page.getByTestId("cloud-linked-name")).toHaveText("Alpha");
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "saved");
    expect(await link(page)).toMatchObject({ id: stored.id, rev: 1, name: "Alpha", autosave: false });
    // The document itself is never kept in the link.
    expect(Object.keys((await link(page))!).sort()).toEqual(["autosave", "id", "name", "rev"]);
  });

  test("updates the linked project with the revision it holds, and offers save-as-new", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    await rename(page, "Beta");
    await openCloud(page);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    await closeCloud(page);

    await rename(page, "Beta v2");
    await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "changed");
    await openCloud(page);
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "changed");
    await expect(page.getByTestId("cloud-save-new")).toHaveText("Save as new");
    await page.getByTestId("cloud-save").click();
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");

    const put = cloud.writes("PUT")[0]!;
    expect(put.body).toMatchObject({ rev: 1, name: "Beta v2" });
    expect(put.contentType).toBe("application/json");
    const stored = [...cloud.projects.values()][0]!;
    expect(stored.rev).toBe(2);
    expect(stored.name).toBe("Beta v2");
    expect(cloud.projects.size).toBe(1);
    expect(await link(page)).toMatchObject({ rev: 2, name: "Beta v2" });
    await expect(page.getByTestId(`cloud-name-${stored.id}`)).toHaveText("Beta v2");

    // Save as new makes a second project and moves the link to it.
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-count")).toHaveText("2 of 100 projects");
    expect(cloud.projects.size).toBe(2);
    expect((await link(page))!.id).not.toBe(stored.id);
  });

  test("renames from the list: Enter saves with the revision, Escape only leaves the field", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    const p = seedFace(cloud, "Gamma");
    await openCloud(page);

    await page.getByTestId(`cloud-rename-${p.id}`).click();
    const input = page.getByTestId(`cloud-rename-input-${p.id}`);
    await expect(input).toBeFocused();
    await input.fill("Discarded");
    await input.press("Escape");
    // Escape left the field but not the dialog, and sent nothing.
    await expect(page.getByTestId("cloud-dialog")).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId(`cloud-name-${p.id}`)).toHaveText("Gamma");
    expect(cloud.writes("PUT")).toEqual([]);

    await page.getByTestId(`cloud-rename-${p.id}`).click();
    await input.fill("Gamma renamed");
    await input.press("Enter");
    await expect(page.getByTestId(`cloud-name-${p.id}`)).toHaveText("Gamma renamed");
    expect(cloud.writes("PUT")[0]!.body).toEqual({ rev: 1, name: "Gamma renamed" });
    expect(cloud.projects.get(p.id)!.rev).toBe(2);
  });

  test("opens a project into the editor, links it, and asks before replacing unsaved work", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    const p = seedFace(cloud, "Delta");

    // The untouched start face is replaced without a question.
    await openCloud(page);
    await page.getByTestId(`cloud-open-${p.id}`).click();
    await expect(page.getByTestId("cloud-dialog")).toBeHidden();
    await expect(page.getByTestId("face-name")).toHaveValue("Delta");
    await expect(page.getByText("“Delta” opened from the cloud")).toBeVisible();
    expect(await link(page)).toMatchObject({ id: p.id, rev: 1, name: "Delta" });
    await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "saved");

    // Unsaved edits: the dialog asks first, and Cancel keeps the work.
    await rename(page, "Unsaved edit");
    await openCloud(page);
    await page.getByTestId(`cloud-open-${p.id}`).click();
    await expect(page.getByTestId("cloud-replace")).toContainText("Replace what you have open?");
    await page.getByTestId("cloud-replace-cancel").click();
    await expect(page.getByTestId("cloud-replace")).toHaveCount(0);
    await expect(page.getByTestId("cloud-dialog")).toBeVisible();
    await closeCloud(page);
    await expect(page.getByTestId("face-name")).toHaveValue("Unsaved edit");

    await openCloud(page);
    await page.getByTestId(`cloud-open-${p.id}`).click();
    await page.getByTestId("cloud-replace-confirm").click();
    await expect(page.getByTestId("cloud-dialog")).toBeHidden();
    await expect(page.getByTestId("face-name")).toHaveValue("Delta");
  });

  test("an unlinked face that is not the blank start face also asks before being replaced", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    const p = seedFace(cloud, "Epsilon");
    await page.getByTestId("open-templates").click();
    await page.getByTestId("template-classic").click();
    await openCloud(page);
    await page.getByTestId(`cloud-open-${p.id}`).click();
    await expect(page.getByTestId("cloud-replace")).toBeVisible();
    await page.getByTestId("cloud-replace-confirm").click();
    await expect(page.getByTestId("face-name")).toHaveValue("Epsilon");
  });

  test("deletes with an in-dialog confirmation and unlinks the open face", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    await rename(page, "Zeta");
    await openCloud(page);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-linked")).toBeVisible();
    const id = cloud.byName("Zeta").id;

    await page.getByTestId(`cloud-delete-${id}`).click();
    await expect(page.getByTestId(`cloud-delete-confirm-${id}`)).toContainText("Delete “Zeta” from the cloud?");
    // Cancel leaves it.
    await page.getByTestId(`cloud-delete-confirm-${id}`).getByRole("button", { name: "Cancel" }).click();
    expect(cloud.projects.size).toBe(1);
    await page.getByTestId(`cloud-delete-${id}`).click();
    await page.getByTestId(`cloud-delete-yes-${id}`).click();
    await expect(page.getByTestId("cloud-empty")).toBeVisible();
    expect(cloud.projects.size).toBe(0);
    await expect(page.getByTestId("cloud-linked")).toHaveCount(0);
    expect(await link(page)).toBeNull();
    // The face itself is still open.
    await expect(page.getByTestId("face-name")).toHaveValue("Zeta");
  });

  test("a project over the size limit shows the measured size against the limit, inline, and sends nothing", async ({ page }) => {
    const cloud = await mock(page, "pro");
    cloud.maxBytes = 2048;
    await open(page);
    await openCloud(page);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-message")).toContainText(/too big for the cloud: [\d.]+ KB, the limit is 2 KB/);
    expect(cloud.writes("POST")).toEqual([]);
    await expect(page.getByTestId("cloud-save-new")).toBeEnabled();
  });

  test("a 413 from the server is explained too", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    await openCloud(page);
    // The client believes 5 MB is fine (the list said so); the server disagrees.
    cloud.maxBytes = 2048;
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-message")).toContainText("over the 2 KB cloud limit");
  });

  test("a full library, an outage and the network each get their own inline message", async ({ page }) => {
    const cloud = await mock(page, "pro");
    cloud.max = 1;
    await open(page);
    seedFace(cloud, "Only one");
    await openCloud(page);
    await expect(page.getByTestId("cloud-count")).toHaveText("1 of 1 projects");
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-message")).toContainText("The cloud is full, the limit is 1 projects");

    cloud.max = 100;
    cloud.failNext("POST", 503);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-message")).toContainText("account service can't be reached");
    await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "unlinked");

    cloud.failNext("POST", 500);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-message")).toContainText("Something went wrong on the server");

    let aborted = false;
    await page.route("**/api/fit/studio/projects**", (route) => {
      if (aborted || route.request().method() !== "POST") return route.fallback();
      aborted = true;
      return route.abort("failed");
    });
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-message")).toContainText("Can't connect");

    // And a clean retry works.
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-message")).toHaveCount(0);
    await expect(page.getByTestId("cloud-count")).toHaveText("2 of 100 projects");
  });

  test("a rev conflict on save offers the choices; keeping both saves a copy and leaves the cloud version alone", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    await rename(page, "Eta");
    await openCloud(page);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    const original = cloud.byName("Eta");

    await closeCloud(page);

    cloud.externalEdit(original.id, { name: "Eta (from my laptop)" });
    await rename(page, "Eta local edit");
    await openCloud(page);
    await page.getByTestId("cloud-save").click();
    const conflict = page.getByTestId("cloud-conflict");
    await expect(conflict).toContainText("This project changed somewhere else");
    await expect(page.getByTestId("cloud-save")).toHaveCount(0);
    await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "conflict");

    await page.getByTestId("cloud-keep-both").click();
    await expect(conflict).toHaveCount(0);
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    expect(cloud.projects.size).toBe(2);
    const copy = cloud.byName("Eta local edit (copy)");
    expect(copy.id).not.toBe(original.id);
    // The cloud version is untouched, apart from what the other device did.
    expect(cloud.projects.get(original.id)!.name).toBe("Eta (from my laptop)");
    expect(cloud.projects.get(original.id)!.rev).toBe(2);
    expect(await link(page)).toMatchObject({ id: copy.id, rev: 1 });
    await expect(page.getByTestId("face-name")).toHaveValue("Eta local edit (copy)");
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
  });

  test("a rev conflict: loading the cloud version replaces the local edits and relinks", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    await rename(page, "Theta");
    await openCloud(page);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    const original = cloud.byName("Theta");
    const remote = { ...(original.document as { project: Record<string, unknown> }), project: { ...(original.document as { project: Record<string, unknown> }).project, name: "Theta remote" } };
    await closeCloud(page);
    cloud.externalEdit(original.id, { name: "Theta remote", document: remote });

    await rename(page, "Theta local");
    await openCloud(page);
    await page.getByTestId("cloud-save").click();
    await expect(page.getByTestId("cloud-conflict")).toBeVisible();
    await page.getByTestId("cloud-load-cloud").click();
    await expect(page.getByTestId("cloud-conflict")).toHaveCount(0);
    await expect(page.getByTestId("face-name")).toHaveValue("Theta remote");
    expect(await link(page)).toMatchObject({ id: original.id, rev: 2, name: "Theta remote" });
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    expect(cloud.projects.size).toBe(1);
    // The local edit is one undo away.
    await closeCloud(page);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("face-name")).toHaveValue("Theta local");
  });

  test("Cancel on a conflict leaves everything as it is and the conflict comes back next time", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    await rename(page, "Iota");
    await openCloud(page);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    const original = cloud.byName("Iota");
    await closeCloud(page);
    cloud.externalEdit(original.id);
    await rename(page, "Iota edit");
    await openCloud(page);
    await page.getByTestId("cloud-save").click();
    await expect(page.getByTestId("cloud-conflict")).toBeVisible();
    await page.getByTestId("cloud-conflict-cancel").click();
    await expect(page.getByTestId("cloud-dialog")).toBeHidden();
    await expect(page.getByTestId("face-name")).toHaveValue("Iota edit");
    await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "conflict");
    await openCloud(page);
    await expect(page.getByTestId("cloud-conflict")).toBeVisible();
  });

  test.describe("autosave", () => {
    test("is off by default, and when on writes once after the quiet time, with the revision held", async ({ page }) => {
      const cloud = await mock(page, "pro");
      await open(page, { autosaveMs: 400 });
      await rename(page, "Kappa");
      await openCloud(page);
      await page.getByTestId("cloud-save-new").click();
      await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
      const toggle = page.getByRole("switch", { name: "Autosave to the cloud" });
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await closeCloud(page);

      // Off: edits are not sent.
      await rename(page, "Kappa 1");
      await page.waitForTimeout(1200);
      expect(cloud.writes("PUT")).toEqual([]);

      await openCloud(page);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      expect((await link(page))!.autosave).toBe(true);
      // Turning it on with edits waiting writes them.
      await expect.poll(() => cloud.writes("PUT").length).toBe(1);
      expect(cloud.writes("PUT")[0]!.body).toMatchObject({ rev: 1, name: "Kappa 1" });
      await closeCloud(page);

      // A burst of edits is one write.
      for (const name of ["Kappa 2", "Kappa 22", "Kappa 222"]) {
        await rename(page, name);
        await page.waitForTimeout(80);
      }
      await expect.poll(() => cloud.writes("PUT").length).toBe(2);
      await page.waitForTimeout(1000);
      expect(cloud.writes("PUT")).toHaveLength(2);
      expect(cloud.writes("PUT")[1]!.body).toMatchObject({ rev: 2, name: "Kappa 222" });
      expect(cloud.projects.size).toBe(1);
      expect([...cloud.projects.values()][0]!.rev).toBe(3);
      expect(await link(page)).toMatchObject({ rev: 3 });
      await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "saved");
    });

    test("stops at a conflict and tells the user, without writing again", async ({ page }) => {
      const cloud = await mock(page, "pro");
      await open(page, { autosaveMs: 300 });
      await rename(page, "Lambda");
      await openCloud(page);
      await page.getByTestId("cloud-save-new").click();
      await page.getByRole("switch", { name: "Autosave to the cloud" }).click();
      await closeCloud(page);
      cloud.externalEdit(cloud.byName("Lambda").id);

      await rename(page, "Lambda 1");
      await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "conflict");
      await expect(page.getByText("The cloud project changed somewhere else")).toBeVisible();
      expect(cloud.writes("PUT")).toHaveLength(1);
      await rename(page, "Lambda 2");
      await page.waitForTimeout(1000);
      expect(cloud.writes("PUT")).toHaveLength(1);

      // The toast leads to the choices.
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await expect(page.getByTestId("cloud-conflict")).toBeVisible();
      await page.getByTestId("cloud-keep-both").click();
      await expect(page.getByTestId("cloud-conflict")).toHaveCount(0);
      // Resolved: autosave runs again against the copy.
      await closeCloud(page);
      await rename(page, "Lambda 3");
      await expect.poll(() => cloud.writes("PUT").length).toBe(2);
      expect(cloud.writes("PUT")[1]!.body).toMatchObject({ rev: 1, name: "Lambda 3" });
    });

    test("a failed write shows an error state, never blocks editing, and the next edit retries", async ({ page }) => {
      const cloud = await mock(page, "pro");
      await open(page, { autosaveMs: 300 });
      await rename(page, "Mu");
      await openCloud(page);
      await page.getByTestId("cloud-save-new").click();
      await page.getByRole("switch", { name: "Autosave to the cloud" }).click();
      await closeCloud(page);

      cloud.failNext("PUT", 503);
      await rename(page, "Mu 1");
      await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "error");
      await expect(page.getByText("Cloud autosave failed")).toBeVisible();
      // Editing is unaffected and the local autosave holds the work.
      await rename(page, "Mu 2");
      await expect.poll(() => cloud.writes("PUT").length).toBe(2);
      await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "saved");
      expect(cloud.writes("PUT")[1]!.body).toMatchObject({ rev: 1, name: "Mu 2" });
      expect(((await localProject(page)) as { name: string }).name).toBe("Mu 2");
    });
  });

  test("the link survives a reload; the face then counts as changed until saved again", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    await rename(page, "Nu");
    await openCloud(page);
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    await page.reload();
    await expect(page.getByTestId("face-canvas")).toBeVisible();
    await expect(page.getByTestId("open-cloud")).toHaveAttribute("data-cloud-state", "changed");
    await openCloud(page);
    await expect(page.getByTestId("cloud-linked-name")).toHaveText("Nu");
    await page.getByTestId("cloud-save").click();
    await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
    expect(cloud.writes("PUT")[0]!.body).toMatchObject({ rev: 1, name: "Nu" });
  });

  test("a face with a large photo is saved to the cloud within the size limit, locally untouched", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page);
    // A busy 1400 x 1400 picture as a sticker: PNG, several MB as a data URL.
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 1400;
      const ctx = c.getContext("2d")!;
      const img = ctx.createImageData(1400, 1400);
      let seed = 7;
      for (let i = 0; i < img.data.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        img.data[i] = seed >>> 24;
        img.data[i + 1] = (seed >>> 16) & 255;
        img.data[i + 2] = (seed >>> 8) & 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL("image/png").split(",")[1]!;
    });
    for (let i = 0; i < 2; i++) {
      const item = page.getByRole("button", { name: "Image or sticker" });
      if (!(await item.isVisible())) await page.getByRole("button", { name: "Add", exact: true }).click();
      await item.click();
      await page.getByTestId("upload-input").last().setInputFiles({ name: "noise.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
      await page.waitForTimeout(1500);
    }

    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project JSON" }).click()]);
    const localBytes = (await readFile(await dl.path())).byteLength;
    expect(localBytes).toBeGreaterThan(6_000_000);

    await openCloud(page);
    await page.getByTestId("cloud-save-new").click();
    await expect.poll(() => cloud.projects.size, { timeout: 30_000 }).toBe(1);
    const sent = JSON.stringify(cloud.writes("POST")[0]!.body).length;
    expect(sent).toBeLessThan(5 * 1024 * 1024);
    await expect(page.getByTestId("cloud-message")).toContainText("Large images were shrunk");
    // The local export is unchanged by the cloud save.
    await closeCloud(page);
    const [again] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project JSON" }).click()]);
    expect((await readFile(await again.path())).byteLength).toBe(localBytes);
  });
});

test.describe("language", () => {
  test.use({ locale: "fr-FR" });

  test("the dialog is Indonesian by default", async ({ page }) => {
    const cloud = await mock(page, "pro");
    await open(page, { locale: null });
    await expect(page.getByTestId("open-cloud")).toHaveAccessibleName("Proyek cloud");
    seedFace(cloud, "Contoh");
    await openCloud(page);
    const dialog = page.getByTestId("cloud-dialog");
    await expect(dialog.getByRole("heading", { name: "Proyek cloud", level: 2 })).toBeVisible();
    await expect(page.getByTestId("cloud-count")).toHaveText("1 dari 100 proyek");
    await expect(page.getByTestId("cloud-save-new")).toHaveText("Simpan ke cloud");
    await expect(dialog.getByRole("button", { name: /^Buka “Contoh”/ })).toBeVisible();
    await page.getByTestId("cloud-save-new").click();
    await expect(page.getByTestId("cloud-status")).toHaveText("Tersimpan");
    expect(cloud.writes("POST")[0]!.locale).toBe("id");
  });

  test("signed-out and non-Pro prompts are Indonesian", async ({ page }) => {
    await mock(page, "out");
    await open(page, { locale: null });
    await page.getByTestId("open-cloud").click();
    await expect(page.getByTestId("cloud-signed-out")).toContainText("Masuk untuk menyimpan proyekmu di cloud");
    await expect(page.getByTestId("cloud-login")).toHaveText("Masuk");
  });

  test("non-Pro prompt is Indonesian", async ({ page }) => {
    await mock(page, "free");
    await open(page, { locale: null });
    await page.getByTestId("open-cloud").click();
    await expect(page.getByTestId("cloud-free")).toContainText("Simpan ke cloud khusus Pro");
    await expect(page.getByTestId("cloud-pricing")).toHaveText("Lihat paket Pro");
  });
});

test("the header never scrolls sideways at 360 px with the cloud button in it", async ({ page }) => {
  await mock(page, "pro");
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, { locale: "id" });
  await expect(page.getByTestId("open-cloud")).toBeVisible();
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBe(client);
  const box = await page.getByTestId("open-cloud").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await openCloud(page);
  const dialog = await page.getByTestId("cloud-dialog").evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(dialog.scroll).toBeLessThanOrEqual(dialog.client);
});

// Screenshots of every dialog state for visual review: CLOUD_SHOTS=1 bunx playwright test e2e/cloud.spec.ts -g screenshots
const SHOTS = "/run/media/dzul/ioswork/tmp/studio-cloud";
test.describe("screenshots", () => {
  test.skip(!process.env.CLOUD_SHOTS, "set CLOUD_SHOTS=1 to write the review screenshots");
  test.use({ locale: "fr-FR" });

  for (const [theme, width, height] of [
    ["light", 360, 760],
    ["dark", 360, 760],
    ["light", 1280, 800],
    ["dark", 1280, 800],
  ] as const) {
    test(`${theme} ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await page.addInitScript((t) => localStorage.setItem("vite-ui-theme", t), theme);
      // The dialog fades in, and the list reload after a save settles a moment later.
      const shoot = async (name: string) => {
        await page.waitForTimeout(450);
        await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${width}.png` });
      };

      // Signed out.
      const out = await mock(page, "out");
      await open(page, { locale: null });
      await page.getByTestId("open-cloud").click();
      await expect(page.getByTestId("cloud-signed-out")).toBeVisible();
      await shoot("1-signed-out");
      void out;
      await page.unroute("**/rpc/fitness/cloudAccess");
      await page.unroute("**/api/fit/studio/projects**");
      await closeCloud(page);

      // Signed in, not Pro, with projects.
      const free = await mock(page, "free");
      seedFace(free, "Tampilan lama dari masa Pro");
      seedFace(free, "Jam olahraga");
      await openCloud(page);
      await shoot("2-free");
      await closeCloud(page);
      await page.unroute("**/rpc/fitness/cloudAccess");
      await page.unroute("**/api/fit/studio/projects**");

      // Pro: empty, then saved, list, delete confirm, conflict, too large.
      const pro = await mock(page, "pro");
      await openCloud(page);
      await expect(page.getByTestId("cloud-empty")).toBeVisible();
      await shoot("3-pro-empty");
      await page.getByTestId("cloud-save-new").click();
      await expect(page.getByTestId("cloud-status")).toHaveAttribute("data-state", "saved");
      await shoot("4-pro-saved");
      await closeCloud(page);
      await page.getByTestId("open-templates").click();
      await page.getByTestId("template-classic").click();
      seedFace(pro, "Klasik dengan nama yang sangat panjang sekali untuk uji luapan");
      await openCloud(page);
      await page.getByTestId(`cloud-open-${pro.byName("Klasik dengan nama yang sangat panjang sekali untuk uji luapan").id}`).click();
      await expect(page.getByTestId("cloud-replace")).toBeVisible();
      await shoot("5-replace-confirm");
      await page.getByTestId("cloud-replace-cancel").click();
      const first = [...pro.projects.values()][0]!;
      await page.getByTestId(`cloud-delete-${first.id}`).click();
      await shoot("6-delete-confirm");
      await page.getByTestId(`cloud-delete-confirm-${first.id}`).getByRole("button").last().click();
      const linked = (await link(page))!;
      pro.externalEdit(linked.id);
      await page.getByTestId("cloud-save").click();
      await expect(page.getByTestId("cloud-conflict")).toBeVisible();
      await shoot("7-conflict");
      await page.getByTestId("cloud-conflict-cancel").click();
      pro.maxBytes = 2048;
      await openCloud(page);
      await page.getByTestId("cloud-keep-both").click();
      await expect(page.getByTestId("cloud-message")).toBeVisible();
      await shoot("8-too-large");
    });
  }
});
