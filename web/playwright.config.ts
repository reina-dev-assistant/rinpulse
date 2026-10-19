import { defineConfig } from "@playwright/test";

/**
 * Studio is served under /studio/ (Vite base). By default the tests build it and run `vite preview`, which runs the real entry
 * Worker (worker/index.ts) on :4173. Set STUDIO_URL to the Studio URL of a deployment instead, trailing slash included, for
 * example https://app.fit.joyorogo.com/studio/.
 */
const remote = process.env.STUDIO_URL;
const local = "http://localhost:4173/studio/";
const target = remote ?? local;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: "list",
  // A baseURL that ends in a slash makes `page.goto("./")` land on the app, and `goto("/")` on the host root.
  use: { baseURL: target.endsWith("/") ? target : `${target}/`, viewport: { width: 1440, height: 900 }, acceptDownloads: true },
  webServer: remote
    ? undefined
    : {
        command: "bunx vite build && bunx vite preview --port 4173 --strictPort",
        url: local,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
