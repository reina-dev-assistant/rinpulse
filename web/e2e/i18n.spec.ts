import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, stored?: string): Promise<void> {
  await page.addInitScript(
    ([choice]) => {
      localStorage.setItem("joyofit-studio:help-seen", "1");
      // Only on the first load of the test, so a switch made on the page survives a reload.
      if (choice && !sessionStorage.getItem("seeded")) {
        localStorage.setItem("jfit-locale", choice);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [stored ?? ""],
  );
  await page.goto("./");
  await expect(page.getByTestId("face-canvas")).toBeVisible();
}

test.describe("default language", () => {
  test.use({ locale: "fr-FR" });

  test("opens in Indonesian when nothing is stored and the browser language is not shipped", async ({ page }) => {
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page.getByTestId("back-to-web")).toHaveAccessibleName("Kembali ke JoyoFit Web");
    await expect(page.getByRole("button", { name: "Urungkan" })).toBeVisible();
    await expect(page.getByTestId("language-switch")).toHaveText("EN");
  });
});

test.describe("browser language", () => {
  test.use({ locale: "en-GB" });

  test("an English browser opens Studio in English", async ({ page }) => {
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  test("the language JoyoFit Web stored on this origin wins over the browser language", async ({ page }) => {
    await open(page, "id");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page.getByRole("button", { name: "Urungkan" })).toBeVisible();
  });
});

test("the switch changes every panel at once, is remembered under JoyoFit Web's key, and survives a reload", async ({ page }) => {
  await open(page, "id");
  await expect(page.getByTestId("language-switch")).toHaveText("EN");
  await expect(page.getByRole("button", { name: "Template" })).toBeVisible();
  await expect(page.getByLabel("Lapisan").first()).toBeVisible();

  await page.getByTestId("language-switch").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("language-switch")).toHaveText("ID");
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByTestId("back-to-web")).toHaveAccessibleName("Back to JoyoFit Web");
  expect(await page.evaluate(() => localStorage.getItem("jfit-locale"))).toBe("en");

  await page.getByTestId("open-templates").click();
  await expect(page.getByTestId("templates-dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByTestId("face-canvas")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByTestId("language-switch").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.getByRole("button", { name: "Urungkan" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("jfit-locale"))).toBe("id");
});

test("a language picked in another tab of the same origin is followed live", async ({ page, context }) => {
  await open(page, "id");
  const other = await context.newPage();
  await other.goto("./");
  await other.getByTestId("language-switch").click();
  await expect(other.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
});

test("the Indonesian header fits 360 px wide without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, "id");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
