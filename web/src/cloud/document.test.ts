import { beforeEach, describe, expect, it } from "vitest";
import { emptyProject, newImage } from "@/model/defaults";
import type { Project } from "@/model/types";
import { bodyBytes } from "./api";
import { SHRINK_LEVELS, buildCloudDocument, clearDocumentCache, type DocumentDeps, type RawAsset, type ShrinkLevel } from "./document";

const blobOf = (bytes: number, type: string): Blob => new Blob([new Uint8Array(bytes)], { type });

/** Assets by id; `reencode` shrinks a blob in proportion to the level's longest side, so the ladder has something to bite on. */
function deps(assets: Record<string, RawAsset>, log: string[] = []): DocumentDeps {
  return {
    readAsset: (id) => assets[id] ?? null,
    // A data URL as long as its blob is big (plus the header), so sizes in the tests are easy to read.
    toDataUrl: async (blob) => `data:${blob.type};base64,${"A".repeat(blob.size)}`,
    reencode: async (blob, type, level: ShrinkLevel) => {
      log.push(`${type}:${type === "image/png" ? level.pngSide : level.jpegSide}`);
      const side = type === "image/png" ? level.pngSide : level.jpegSide;
      return blobOf(Math.round(blob.size * Math.min(1, side / 1024) ** 2), type);
    },
  };
}

function withImages(ids: string[]): Project {
  const project = emptyProject();
  return { ...project, elements: [...project.elements, ...ids.map((id) => newImage(id, 100, 100))] };
}

describe("buildCloudDocument", () => {
  // Asset ids are unique in the app; these tests reuse them.
  beforeEach(clearDocumentCache);

  it("is the plain project file while it fits, byte for byte", async () => {
    const assets = { a: { name: "a.png", type: "image/png", blob: blobOf(10_000, "image/png") } };
    const log: string[] = [];
    const project = withImages(["a"]);
    const built = await buildCloudDocument(project, 1_000_000, deps(assets, log));
    expect(log).toEqual([]);
    expect(built.shrunk).toBe(false);
    expect(built.document.format).toBe("joyofit-studio-project");
    expect(built.document.project).toBe(project);
    expect(built.document.assets.a!.dataUrl).toBe(`data:image/png;base64,${"A".repeat(10_000)}`);
    expect(built.bytes).toBe(bodyBytes(JSON.stringify(built.document)));
  });

  it("an image the project names but the store lost is simply not embedded", async () => {
    const built = await buildCloudDocument(withImages(["gone"]), 1_000_000, deps({}));
    expect(built.document.assets).toEqual({});
  });

  it("re-encodes the big images, level by level, only until the document fits", async () => {
    const assets = {
      big: { name: "big.png", type: "image/png", blob: blobOf(600_000, "image/png") },
      photo: { name: "p.jpg", type: "image/jpeg", blob: blobOf(300_000, "image/jpeg") },
      tiny: { name: "t.png", type: "image/png", blob: blobOf(1_000, "image/png") },
    };
    const log: string[] = [];
    // Plain: ~900 KB. Level 1 (png 512, jpeg 1000): ~150 KB + ~290 KB. Budget sits between plain and level 1.
    const built = await buildCloudDocument(withImages(["big", "photo", "tiny"]), 500_000, deps(assets, log));
    expect(built.shrunk).toBe(true);
    expect(built.bytes).toBeLessThanOrEqual(500_000);
    expect(log.filter((l) => l.startsWith("image/png"))).toEqual(["image/png:512"]);
    // The tiny one is below the re-encode threshold and stays as it was.
    expect(built.document.assets.tiny!.dataUrl).toBe(`data:image/png;base64,${"A".repeat(1_000)}`);
    expect(built.document.assets.big!.dataUrl.length).toBeLessThan(600_000);
  });

  it("goes down the ladder as far as needed, then reports the smallest it could make", async () => {
    const assets = { big: { name: "big.png", type: "image/png", blob: blobOf(900_000, "image/png") } };
    const log: string[] = [];
    const built = await buildCloudDocument(withImages(["big"]), 10_000, deps(assets, log));
    expect(log).toEqual(SHRINK_LEVELS.map((l) => `image/png:${l.pngSide}`));
    expect(built.bytes).toBeGreaterThan(10_000);
    expect(built.shrunk).toBe(true);
    expect(built.document.assets.big!.dataUrl.length).toBeLessThan(120_000);
  });

  it("keeps the original when re-encoding would not make it smaller", async () => {
    const assets = { x: { name: "x.png", type: "image/png", blob: blobOf(200_000, "image/png") } };
    const stubborn: DocumentDeps = { ...deps(assets), reencode: async (blob) => blobOf(blob.size + 10, "image/png") };
    const built = await buildCloudDocument(withImages(["x"]), 1_000, stubborn);
    expect(built.shrunk).toBe(false);
    expect(built.document.assets.x!.dataUrl.length).toBe("data:image/png;base64,".length + 200_000);
  });

  it("leaves formats it cannot re-encode safely alone", async () => {
    const assets = { w: { name: "w.webp", type: "image/webp", blob: blobOf(200_000, "image/webp") } };
    const log: string[] = [];
    const built = await buildCloudDocument(withImages(["w"]), 1_000, deps(assets, log));
    expect(log).toEqual([]);
    expect(built.shrunk).toBe(false);
  });

  it("never changes the project or the stored blobs", async () => {
    const blob = blobOf(600_000, "image/png");
    const assets = { a: { name: "a.png", type: "image/png", blob } };
    const project = withImages(["a"]);
    const before = JSON.stringify(project);
    await buildCloudDocument(project, 10_000, deps(assets));
    expect(JSON.stringify(project)).toBe(before);
    expect(assets.a.blob).toBe(blob);
    expect(blob.size).toBe(600_000);
  });
});
