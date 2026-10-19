import { describe, expect, it } from "vitest";
import { THUMB_LIMIT, THUMB_STEPS, fitThumbnail } from "./thumbnail";

describe("fitThumbnail", () => {
  it("keeps the nicest picture when it fits", async () => {
    const seen: number[] = [];
    const result = await fitThumbnail(async (step) => {
      seen.push(step.width);
      return "x".repeat(1000);
    });
    expect(result).toHaveLength(1000);
    expect(seen).toEqual([102]);
  });

  it("steps down until the data URL fits", async () => {
    const used: number[] = [];
    const result = await fitThumbnail(async (step) => {
      used.push(step.quality);
      return "x".repeat(step.width === 68 ? 5000 : 20_000);
    });
    expect(result).toHaveLength(5000);
    expect(used).toEqual([0.6, 0.4, 0.4, 0.35]);
  });

  it("gives up with null when even the smallest is too big", async () => {
    expect(await fitThumbnail(async () => "x".repeat(THUMB_LIMIT + 1))).toBeNull();
  });

  it("accepts a data URL exactly at the limit", async () => {
    expect(await fitThumbnail(async () => "x".repeat(THUMB_LIMIT))).toHaveLength(THUMB_LIMIT);
  });

  it("keeps the face's 408:480 aspect ratio at every step and gets smaller", () => {
    for (const step of THUMB_STEPS) expect(Math.abs(step.width / step.height - 408 / 480)).toBeLessThan(0.01);
    const sizes = THUMB_STEPS.map((s) => s.width * s.height * s.quality);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });
});
