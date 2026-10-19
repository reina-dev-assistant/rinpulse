import { CanvasTexture, SRGBColorSpace } from "three";

export const BRAND_RING = "#58C4DE";
export const BRAND_DOT = "#BFE7F3";
export const BRAND_INK = "#0A6580";

/**
 * The JoyoFit mark (public/brand/logo-mark.svg): a step ring open from 12 o'clock with a trailing dot, drawn into a 2D canvas
 * centred on (cx, cy) with [size] the width of the 1024 box.
 */
export function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, ring: string, dot: string): void {
  const k = size / 1024;
  g.save();
  g.translate(cx - 512 * k, cy - 512 * k);
  g.strokeStyle = ring;
  g.lineWidth = 120 * k;
  g.lineCap = "round";
  g.beginPath();
  g.arc(512 * k, 512 * k, 262 * k, -Math.PI / 2, (150 * Math.PI) / 180);
  g.stroke();
  g.fillStyle = dot;
  g.beginPath();
  g.arc(255.73 * k, 457.53 * k, 74 * k, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** The jersey print: mark and "JoyoFit" on a dark rounded patch, readable on any jersey colour. */
export function jerseyLogoTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 80;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "rgba(14,22,28,0.88)";
  g.beginPath();
  g.roundRect(4, 4, 248, 72, 22);
  g.fill();
  drawMark(g, 44, 40, 64, BRAND_RING, BRAND_DOT);
  g.fillStyle = "#ffffff";
  g.font = "800 40px 'Plus Jakarta Sans Variable', system-ui, sans-serif";
  g.textBaseline = "middle";
  g.fillText("JoyoFit", 84, 42);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
