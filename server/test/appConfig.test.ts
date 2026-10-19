import { describe, expect, it } from "vitest";

import { DEFAULT_STORE_URLS, buildAppConfig } from "../src/appConfig";
import { call, env } from "./helpers";

describe("buildAppConfig", () => {
  it("gates nobody and uses the default store pages when nothing is stored", () => {
    expect(buildAppConfig({})).toEqual({
      android: { minBuild: 0, latestBuild: 0, storeUrl: DEFAULT_STORE_URLS.android },
      ios: { minBuild: 0, latestBuild: 0, storeUrl: DEFAULT_STORE_URLS.ios },
      message: null,
    });
  });

  it("reads per-platform builds, urls and the message; junk counts as off or default", () => {
    const cfg = buildAppConfig({
      android_min_build: "1470000",
      android_latest_build: "1480000",
      android_store_url: "https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit",
      ios_min_build: "abc",
      ios_latest_build: "-5",
      ios_store_url: "javascript:alert(1)",
      message: "  Ada perbaikan penting.  ",
    });
    expect(cfg.android).toEqual({
      minBuild: 1470000,
      latestBuild: 1480000,
      storeUrl: "https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit",
    });
    expect(cfg.ios).toEqual({ minBuild: 0, latestBuild: 0, storeUrl: DEFAULT_STORE_URLS.ios });
    expect(cfg.message).toBe("Ada perbaikan penting.");
  });

  it("never lets latest sit below min", () => {
    expect(buildAppConfig({ ios_min_build: "50", ios_latest_build: "10" }).ios.latestBuild).toBe(50);
  });
});

describe("GET /v1/app-config", () => {
  it("answers without a session, gate off by default, cacheable for a minute", async () => {
    const res = await call("/v1/app-config");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = (await res.json()) as { android: { minBuild: number }; ios: { minBuild: number } };
    expect(body.android.minBuild).toBe(0);
    expect(body.ios.minBuild).toBe(0);
  });

  it("serves what the owner stored in D1", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('ios_min_build', '42')"),
      env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('ios_latest_build', '45')"),
    ]);
    const body = (await (await call("/v1/app-config")).json()) as { ios: { minBuild: number; latestBuild: number } };
    expect(body.ios).toMatchObject({ minBuild: 42, latestBuild: 45 });
    await env.DB.prepare("DELETE FROM app_config").run();
  });
});
