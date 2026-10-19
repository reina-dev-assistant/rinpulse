import { fontsOf } from "@/editor/useFonts";
import { blobToDataUrl } from "@/model/assets";
import { SCREEN_H, SCREEN_W, type Project, type Sim } from "@/model/types";
import { context2d, createSurface, type Surface } from "@/render/canvas";
import { ensureFont } from "@/render/fonts";
import { drawProject } from "@/render/scene";
import { shownSim } from "@/render/values";

/** Longest thumbnail data URL we send, in characters; the server takes 16 KiB, this leaves room. */
export const THUMB_LIMIT = 12 * 1024;

export interface ThumbStep {
  width: number;
  height: number;
  quality: number;
}

/** From the nicest picture to the smallest one that still shows the face; all keep the 408:480 aspect ratio. */
export const THUMB_STEPS: readonly ThumbStep[] = [
  { width: 102, height: 120, quality: 0.6 },
  { width: 102, height: 120, quality: 0.4 },
  { width: 85, height: 100, quality: 0.4 },
  { width: 68, height: 80, quality: 0.35 },
  { width: 51, height: 60, quality: 0.3 },
];

/** The first step whose encoding fits `limit`, or null when none does. */
export async function fitThumbnail(encode: (step: ThumbStep) => Promise<string>, limit: number = THUMB_LIMIT): Promise<string | null> {
  for (const step of THUMB_STEPS) {
    const dataUrl = await encode(step);
    if (dataUrl.length <= limit) return dataUrl;
  }
  return null;
}

interface BlobSurface {
  convertToBlob(options: { type: string; quality: number }): Promise<Blob>;
}

/**
 * A small JPEG of the whole face as the stage shows it (live layers included, drawn at the simulated time). Null when the browser
 * cannot draw or encode it: the project is saved without a thumbnail then.
 */
export async function makeThumbnail(project: Project, stageSim: Sim): Promise<string | null> {
  try {
    // Digits drawn before their font arrived would be in the fallback font.
    await Promise.all(fontsOf(project.elements).map(ensureFont));
    const full = createSurface(SCREEN_W, SCREEN_H);
    const fullCtx = context2d(full);
    fullCtx.fillStyle = "#000000";
    fullCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    drawProject(fullCtx, project, shownSim(stageSim));
    return await fitThumbnail(async ({ width, height, quality }) => {
      const small: Surface = createSurface(width, height);
      const ctx = context2d(small);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(full as unknown as CanvasImageSource, 0, 0, width, height);
      const blob = await (small as unknown as BlobSurface).convertToBlob({ type: "image/jpeg", quality });
      return blobToDataUrl(blob);
    });
  } catch {
    return null;
  }
}
