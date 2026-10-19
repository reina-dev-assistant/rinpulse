// The pure part of picking a comment photo; `pickCommentImage.ts` holds the picker and the manipulator.

/** Longest side of a comment photo after it is shrunk, in pixels. */
export const COMMENT_IMAGE_SIDE = 1280;

/** JPEG quality of that file. */
export const COMMENT_IMAGE_QUALITY = 0.8;

/** The side to resize to so the longest side is `COMMENT_IMAGE_SIDE`; null when the picture is already small enough or its size is unknown. */
export function commentImageResize(width: number, height: number): { width: number } | { height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || Math.max(width, height) <= COMMENT_IMAGE_SIDE) return null;
  return width >= height ? { width: COMMENT_IMAGE_SIDE } : { height: COMMENT_IMAGE_SIDE };
}
