/** The photo behind a sticker is shown on a 1080-wide card, so anything much larger only costs memory. Longest side, px. */
export const PHOTO_MAX_SIDE = 2048;

export interface Size {
  width: number;
  height: number;
}

/**
 * The size to resize a photo to before it is drawn: the original when its longest side is within `max`, else scaled to
 * `max` on that side, keeping the aspect ratio. A bad size (0, NaN) comes back unchanged so the caller can decide.
 */
export function photoTargetSize(source: Size, max = PHOTO_MAX_SIDE): Size & { resize: boolean } {
  const { width, height } = source;
  if (!(width > 0) || !(height > 0) || Math.max(width, height) <= max) return { width, height, resize: false };
  const scale = max / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale), resize: true };
}
