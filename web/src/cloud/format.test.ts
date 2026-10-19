import { describe, expect, it } from "vitest";
import { formatBytes, formatUpdated, webUrl } from "./format";

describe("formatBytes", () => {
  it("writes bytes, KB and MB", () => {
    expect(formatBytes(512, "en-US")).toBe("512 B");
    expect(formatBytes(2048, "en-US")).toBe("2 KB");
    expect(formatBytes(1536 * 1024, "en-US")).toBe("1.5 MB");
    expect(formatBytes(5 * 1024 * 1024, "en-US")).toBe("5 MB");
  });

  it("follows the language's decimal mark", () => {
    expect(formatBytes(1536 * 1024, "id-ID")).toBe("1,5 MB");
  });
});

describe("formatUpdated", () => {
  const now = Date.UTC(2026, 9, 19, 12, 0, 0);
  it("is relative within a week", () => {
    expect(formatUpdated(now - 30_000, now, "en-US")).toBe("now");
    expect(formatUpdated(now - 5 * 60_000, now, "en-US")).toBe("5 minutes ago");
    expect(formatUpdated(now - 3 * 3_600_000, now, "en-US")).toBe("3 hours ago");
    expect(formatUpdated(now - 2 * 86_400_000, now, "en-US")).toBe("2 days ago");
  });

  it("is relative in Indonesian too", () => {
    expect(formatUpdated(now - 5 * 60_000, now, "id-ID")).toBe("5 menit yang lalu");
  });

  it("is a date after a week, with the year only when it is old", () => {
    expect(formatUpdated(now - 20 * 86_400_000, now, "en-US")).toMatch(/^Sep \d+$/);
    expect(formatUpdated(now - 400 * 86_400_000, now, "en-US")).toMatch(/2025/);
  });

  it("does not print a future time as relative past", () => {
    expect(formatUpdated(now + 60_000, now, "en-US")).toMatch(/Oct/);
  });
});

describe("webUrl", () => {
  it("is relative on the web app's own host and absolute elsewhere", () => {
    expect(webUrl("/login?redirect=/studio/", "app.fit.joyorogo.com")).toBe("/login?redirect=/studio/");
    expect(webUrl("/harga", "app.fit.joyorogo.com")).toBe("/harga");
    expect(webUrl("/harga", "localhost")).toBe("https://app.fit.joyorogo.com/harga");
    expect(webUrl("/login?redirect=/studio/", "joyofit-studio.workers.dev")).toBe("https://app.fit.joyorogo.com/login?redirect=/studio/");
  });
});
