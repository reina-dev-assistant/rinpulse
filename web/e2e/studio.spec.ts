import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, test, type Page } from "@playwright/test";
import { VALUE_TYPES, decodeImage, readHwt, verifyWatchface, writeWatchface } from "@joyofit/hwt";

async function open(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("joyofit-studio:help-seen", "1");
    // The assertions below use the English wording; Indonesian is the default and has its own tests (i18n.spec.ts).
    localStorage.setItem("jfit-locale", "en");
  });
  await page.goto("./");
  await expect(page.getByTestId("face-canvas")).toBeVisible();
}

async function download(page: Page, trigger: () => Promise<void>): Promise<{ name: string; bytes: Uint8Array }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile(path)) };
}

/** Opens the export dialog on the photo face (its default) or switches it to the .hwt. */
async function openExport(page: Page, target: "photo" | "hwt" = "photo"): Promise<void> {
  await page.getByTestId("export-open").click();
  await expect(page.getByTestId("export-dialog")).toBeVisible();
  if (target === "hwt") await page.getByRole("radio", { name: ".hwt (needs Huawei's signature)" }).click();
}

async function idbAssetCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("joyofit-studio", 1);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => req.result.createObjectStore("assets", { keyPath: "id" });
        req.onsuccess = () => {
          const db = req.result;
          const count = db.transaction("assets").objectStore("assets").count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
      }),
  );
}

/** A small picture with no repeating pattern, uploaded through the background's Photo fill. */
async function uploadBackgroundPhoto(page: Page): Promise<void> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 140;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 120, 140);
    g.addColorStop(0, "#c04040");
    g.addColorStop(1, "#4040c0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 120, 140);
    return c.toDataURL("image/png");
  });
  const buffer = Buffer.from(dataUrl.split(",")[1]!, "base64");
  await page.getByTestId("layers").getByTestId("layer-background").click();
  await page.getByRole("radio", { name: "Photo", exact: true }).click();
  await page.getByTestId("upload-input").setInputFiles({ name: "gradient.png", mimeType: "image/png", buffer });
  await expect(page.getByLabel("Zoom", { exact: true })).toBeVisible();
}

test("mounted under /studio/: every asset loads from the prefix, the link back to the web app is there", async ({ page, baseURL }) => {
  const prefix = new URL(baseURL!).pathname;
  const failed: string[] = [];
  page.on("response", (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  });
  await open(page);
  await page.getByTestId("open-templates").click();
  await page.keyboard.press("Escape");
  const sources = await page.evaluate(() => [...document.querySelectorAll("script[src], link[href]")].map((e) => e.getAttribute("src") ?? e.getAttribute("href")!));
  for (const src of sources.filter((s) => s.startsWith("/") && !s.startsWith("//"))) expect(src.startsWith(prefix), src).toBe(true);
  expect(failed).toEqual([]);

  const back = page.getByTestId("back-to-web");
  await expect(back).toBeVisible();
  await expect(back).toHaveAccessibleName("Back to JoyoFit Web");
  await expect(back).toHaveAttribute("href", /^(\/|https:\/\/app\.fit\.joyorogo\.com\/)$/);
});

test("the page never scrolls sideways, from phone to desktop widths", async ({ page }) => {
  for (const width of [360, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, `scrollWidth at ${width}px`).toBe(client);
    // The file and theme buttons stay reachable at every width (they sit on a second header row below lg).
    await expect(page.getByRole("button", { name: "Save project JSON" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Light theme|Dark theme/ })).toBeVisible();
  }
});

test("/studio redirects to /studio/ and an unknown path under it still opens the editor", async ({ page, baseURL }) => {
  const root = new URL(baseURL!);
  await page.addInitScript(() => localStorage.setItem("joyofit-studio:help-seen", "1"));
  await page.goto(root.pathname.replace(/\/$/, ""));
  await expect(page).toHaveURL(root.href);
  await page.goto(`${root.pathname}no/such/page`);
  await expect(page.getByTestId("face-canvas")).toBeVisible();
});

test("add a time element, export, and parse the downloaded .hwt", async ({ page }) => {
  await open(page);

  // A fresh face already has a time layer; add a second one through the Add menu.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Digital time" }).click();
  await expect(page.getByTestId("properties")).toBeVisible();
  await expect(page.getByTestId("layers").getByTestId("layer-time")).toHaveCount(2);

  await page.getByTestId("face-name").fill("Smoke test 1");
  await openExport(page, "hwt");
  await expect(page.getByTestId("checklist")).toBeVisible();
  await expect(page.getByText("Resolution 408 × 480")).toBeVisible();
  // The .hwt is presented as what it is: unsigned, deleted by the watch.
  await expect(page.getByText("An unsigned .hwt is deleted by the watch")).toBeVisible();
  await expect(page.getByTestId("download-hwt")).toBeEnabled();

  const file = await download(page, () => page.getByTestId("download-hwt").click());
  expect(file.name).toBe("Smoketest1.hwt");

  const pkg = readHwt(file.bytes);
  expect(pkg.description.screen).toBe("HWHD13");
  expect(pkg.description.title).toBe("Smoke test 1");
  const wf = pkg.watchface!;
  expect(verifyWatchface(writeWatchface(wf)).problems).toEqual([]);
  expect(wf.images.length).toBeGreaterThan(20);
  const thumb = decodeImage(wf.images[0]!);
  expect([thumb.width, thumb.height]).toEqual([228, 269]);
});

test("the photo face PNG is the default export: 408 x 480, opaque, pictures only", async ({ page }) => {
  await open(page);
  await page.getByTestId("face-name").fill("Photo test 2");
  await openExport(page);
  await expect(page.getByRole("radio", { name: "Photo face (JoyoFit)" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("checklist")).toBeVisible();
  await expect(page.getByText("Size 408 × 480")).toBeVisible();
  await expect(page.getByText("1 live layer left out")).toBeVisible();
  await expect(page.getByText("How to install")).toBeVisible();
  await expect(page.getByTestId("download-hwt")).toHaveCount(0);

  const file = await download(page, () => page.getByTestId("download-photo").click());
  expect(file.name).toBe("Phototest2.photo.png");
  const png = await loadImage(Buffer.from(file.bytes));
  expect([png.width, png.height]).toEqual([408, 480]);
  const canvas = createCanvas(png.width, png.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(png, 0, 0);
  const { data } = ctx.getImageData(0, 0, png.width, png.height);
  let bright = 0;
  let notOpaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 200) bright++;
    if (data[i + 3] !== 255) notOpaque++;
  }
  // The default face is a white clock on black: the clock is live, so the picture is all black.
  expect(bright).toBe(0);
  expect(notOpaque).toBe(0);
});

test("the photo face preview hides the live layers on the stage", async ({ page }) => {
  await open(page);
  const brightPixels = () =>
    page.getByTestId("face-canvas").evaluate((node) => {
      const c = node as HTMLCanvasElement;
      const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! > 200 && data[i + 3]! > 200) n++;
      return n;
    });
  await expect.poll(brightPixels).toBeGreaterThan(100);
  const toggle = page.getByRole("button", { name: "Photo face preview" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(brightPixels).toBe(0);
  await toggle.click();
  await expect.poll(brightPixels).toBeGreaterThan(100);
});

test("debug layout and project JSON downloads", async ({ page }) => {
  await open(page);
  await openExport(page, "hwt");
  await expect(page.getByTestId("download-hwt")).toBeEnabled();
  const debug = await download(page, () => page.getByTestId("export-debug").click());
  const layout = JSON.parse(Buffer.from(debug.bytes).toString("utf8"));
  expect(layout.screen).toBe("HWHD13");
  expect(layout.layout.element.length).toBeGreaterThan(0);
  const project = await download(page, () => page.getByTestId("export-project-json").click());
  const parsed = JSON.parse(Buffer.from(project.bytes).toString("utf8"));
  expect(parsed.format).toBe("joyofit-studio-project");
  expect(parsed.project.elements.length).toBeGreaterThan(1);
});

test("drag moves a layer, undo and redo restore it, autosave survives a reload", async ({ page }) => {
  await open(page);
  const canvas = page.getByTestId("face-canvas");
  const box = (await canvas.boundingBox())!;
  const zoom = box.width / 408;

  // Click the clock digits (inside the default time element).
  await page.mouse.click(box.x + 200 * zoom, box.y + 235 * zoom);
  const x = page.getByLabel("X", { exact: true });
  await expect(x).toBeVisible();
  const before = Number(await x.inputValue());

  await page.mouse.move(box.x + 200 * zoom, box.y + 235 * zoom);
  await page.mouse.down();
  await page.mouse.move(box.x + 200 * zoom + 40 * zoom, box.y + 235 * zoom + 10 * zoom, { steps: 6 });
  await page.mouse.up();
  const moved = Number(await x.inputValue());
  expect(moved).not.toBe(before);

  await page.keyboard.press("Control+z");
  await expect(x).toHaveValue(String(before));
  await page.keyboard.press("Control+Shift+z");
  await expect(x).toHaveValue(String(moved));

  await page.waitForTimeout(600);
  await page.reload();
  await page.getByTestId("layers").getByTestId("layer-time").click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue(String(moved));
});

test("selecting a layer by clicking adds no undo step and keeps the redo stack", async ({ page }) => {
  await open(page);
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  await expect(undo).toBeDisabled();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Date", exact: true }).click();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  const box = (await page.getByTestId("face-canvas").boundingBox())!;
  const zoom = box.width / 408;
  // Click the clock: select it, press and release without moving.
  await page.mouse.click(box.x + 200 * zoom, box.y + 235 * zoom);
  await expect(page.getByTestId("properties")).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
});

test("autosave is flushed when the page is hidden", async ({ page }) => {
  await open(page);
  await page.getByTestId("face-name").fill("Flushed name");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const saved = await page.evaluate(() => localStorage.getItem("joyofit-studio:project:v1"));
  expect(JSON.parse(saved!).name).toBe("Flushed name");
});

test("templates load and export", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-templates").click();
  const card = page.getByTestId("template-classic");
  await expect(card.locator("canvas")).toBeVisible();
  await card.click();
  await expect(page.getByTestId("layers").getByTestId("layer-hand").first()).toBeVisible();
  await openExport(page, "hwt");
  await expect(page.getByTestId("download-hwt")).toBeEnabled();
  const file = await download(page, () => page.getByTestId("download-hwt").click());
  expect(file.name).toBe("Classic.hwt");
  const pkg = readHwt(file.bytes);
  expect(pkg.watchface!.images.length).toBeGreaterThan(5);
});

test("preview-only elements are marked and left out of the export", async ({ page }) => {
  await open(page);
  // An image layer with no picture chosen is preview only.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Image or sticker" }).click();
  await expect(page.getByText("Preview only").first()).toBeVisible();
  await openExport(page, "hwt");
  await expect(page.getByText("Image left out")).toBeVisible();
});

test("the Fields tab lists every codec id with its evidence and gates what it can add", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByTestId("add-tab-fields").click();
  await expect(page.getByTestId("field-browser")).toBeVisible();
  await expect(page.getByTestId("field-count")).toHaveText(`${VALUE_TYPES.length} of ${VALUE_TYPES.length} codec ids`);

  // Verified temperature: evidence badge, slot, and an enabled action.
  await page.getByTestId("field-search").fill("temperature");
  await expect(page.getByTestId("field-badge-4")).toHaveText("Verified");
  await expect(page.getByTestId("field-row-4")).toContainText("slot 21 (weather)");
  await expect(page.getByTestId("field-badge-167")).toHaveText("Unconfirmed");

  // Weather type is an enum whose images Studio cannot draw.
  await page.getByTestId("field-search").fill("weather");
  await expect(page.getByTestId("field-add-248")).toBeDisabled();
  await expect(page.getByTestId("field-reason-248")).toContainText("Needs an image set");

  // An unknown id is preview only and never addable.
  await page.getByTestId("field-search").fill("Activity ring");
  await expect(page.getByTestId("field-badge-158")).toHaveText("Unknown, preview only");
  await expect(page.getByTestId("field-add-158")).toBeDisabled();
  await expect(page.getByTestId("field-reason-158")).toContainText("Unknown id");

  // Add the temperature as a number: a layer, its properties and its simulated-watch slider appear.
  await page.getByTestId("field-search").fill("temperature");
  await page.getByTestId("field-add-4").click();
  await expect(page.getByTestId("layers").getByTestId("layer-widget")).toHaveCount(1);
  await expect(page.getByTestId("layers").getByText("Temperature", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sim-panel").getByText("Temperature", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sim-panel").getByText("Altitude", { exact: true })).toBeVisible();

  // The usable-only filter hides what cannot be added.
  await page.getByTestId("field-search").fill("");
  await page.getByLabel("Only fields I can add").check();
  await expect(page.getByTestId("field-row-248")).toHaveCount(0);
  await expect(page.getByTestId("field-row-161")).toBeVisible();
});

test("the Fields tab works from the mobile layout and the panel nav still switches panels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const nav = page.getByRole("navigation", { name: "Editor panels" });
  await nav.getByRole("button", { name: "Layers" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByTestId("add-tab-fields").click();
  await page.getByTestId("field-search").fill("battery");
  await expect(page.getByTestId("field-row-9")).toBeVisible();
  await page.getByTestId("field-add-9").click();
  await expect(page.getByTestId("layers").getByTestId("layer-widget")).toHaveCount(1);
  await nav.getByRole("button", { name: "Properties" }).click();
  await expect(page.getByTestId("properties")).toBeVisible();
  await nav.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("face-canvas")).toBeVisible();
});

test("the corner handle scales the selected layer", async ({ page }) => {
  await open(page);
  const box = (await page.getByTestId("face-canvas").boundingBox())!;
  const zoom = box.width / 408;
  await page.getByTestId("layers").getByTestId("layer-time").click();
  const size = page.getByLabel("Digit height");
  const before = Number(await size.inputValue());
  const handle = page.locator('[data-handle="se"]');
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 60 * zoom, h.y + h.height / 2 + 30 * zoom, { steps: 8 });
  await page.mouse.up();
  expect(Number(await size.inputValue())).toBeGreaterThan(before);
});

test("uploaded photos live in IndexedDB only while a project or its undo history uses them", async ({ page }) => {
  await open(page);
  await expect.poll(() => idbAssetCount(page)).toBe(0);
  await uploadBackgroundPhoto(page);
  await expect.poll(() => idbAssetCount(page)).toBe(1);

  // Still referenced after a reload: decoded again, and listed in the properties.
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByTestId("layers").getByTestId("layer-background").click();
  await expect(page.getByLabel("Zoom", { exact: true })).toBeVisible();
  expect(await idbAssetCount(page)).toBe(1);

  // Replacing the project keeps the photo for Undo ...
  await page.getByTestId("open-templates").click();
  await page.getByTestId("template-blank").click();
  await page.waitForTimeout(600);
  expect(await idbAssetCount(page)).toBe(1);

  // ... and the next start, with an empty history, deletes it.
  await page.reload();
  await expect.poll(() => idbAssetCount(page)).toBe(0);
});

test("an uploaded photo becomes the background and exports as images inside Huawei's size limit", async ({ page }) => {
  await open(page);
  // A noisy picture: it does not compress, which is the case that needs the export to split it.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = 560;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7919) % 256;
      img.data[i + 1] = (i * 104729) % 256;
      img.data[i + 2] = (i * 1299709) % 256;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  });
  const buffer = Buffer.from(dataUrl.split(",")[1]!, "base64");

  await page.getByTestId("layers").getByTestId("layer-background").click();
  await page.getByRole("radio", { name: "Photo", exact: true }).click();
  await page.getByTestId("upload-input").setInputFiles({ name: "noise.png", mimeType: "image/png", buffer });
  await expect(page.getByLabel("Zoom", { exact: true })).toBeVisible();

  await openExport(page, "hwt");
  await expect(page.getByTestId("download-hwt")).toBeEnabled();
  const file = await download(page, () => page.getByTestId("download-hwt").click());
  const wf = readHwt(file.bytes).watchface!;
  expect(wf.images.every((blob) => blob.length <= 750 * 1024)).toBe(true);
  expect(file.bytes.length).toBeGreaterThan(700_000);

  // The same photo is the photo-face export: the picture itself, 408 x 480.
  await page.getByRole("radio", { name: "Photo face (JoyoFit)" }).click();
  const photo = await download(page, () => page.getByTestId("download-photo").click());
  const png = await loadImage(Buffer.from(photo.bytes));
  expect([png.width, png.height]).toEqual([408, 480]);
});
