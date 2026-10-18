/**
 * The pure parts of setting the JoyoRogo profile photo from JoyoFit: the square crop, the body of `avatar.upload`, which
 * photos `avatar.remove` can remove and what a refusal of the photo picker looks like. No React Native imports, so bun
 * tests it; the picker and the image manipulator live in `features/settings/pickAvatar.ts`.
 */

/** Side of the square JPEG that goes up; JoyoRogo's own app sends the same size. */
export const AVATAR_SIDE = 512;

/** JPEG quality of that file. */
export const AVATAR_QUALITY = 0.85;

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** The largest centered square of a `width` x `height` picture in whole pixels; null when the size is not usable. */
export function cropSquare(width: number, height: number): CropRect | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const w = Math.floor(width);
  const h = Math.floor(height);
  const side = Math.min(w, h);
  if (side < 1) return null;
  return { originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side };
}

/** Body of `avatar.upload`: the manipulator always renders a JPEG. */
export interface AvatarUploadInput {
  imageBase64: string;
  mimeType: 'image/jpeg';
}

/** The upload body for a rendered photo's base64; null when the manipulator returned none. */
export function avatarUploadInput(base64: string | null | undefined): AvatarUploadInput | null {
  return base64 ? { imageBase64: base64, mimeType: 'image/jpeg' } : null;
}

/**
 * True for a photo uploaded to JoyoRogo (`/avatar/<userId>/<32 hex>.<jpg|png|webp>`, the shape of `customAvatarKey` on the
 * server). A Google photo URL is not one: `avatar.remove` leaves it as it is, so JoyoFit only offers "Remove photo" for these.
 */
export function isUploadedAvatar(image: string | null | undefined): boolean {
  return image != null && /^\/avatar\/[^/]+\/[0-9a-f]{32}\.(jpg|png|webp)$/.test(image);
}

/** The photo picker refused for lack of access to the photos: its error code or text names the permission. */
export function isPermissionError(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
  const message = e instanceof Error ? e.message : '';
  return /permission/i.test(code) || /permission/i.test(message);
}
