/** Which share targets exist and how each one is reached. Pure, so the decisions are testable without a device. */

export type ShareOs = 'ios' | 'android';
/**
 * How the Instagram button reaches Instagram.
 * - `stories`: Instagram's Story composer directly (needs a Facebook App ID), sticker or full-bleed background.
 * - `instagram`: the PNG handed to the Instagram app's own share target, where the user picks Story or post.
 * - `system`: the system share sheet, which is the only way to keep the sticker's transparency on iOS without an App ID
 *   (Instagram's iOS route goes through Photos and flattens it).
 */
export type InstagramRoute = 'stories' | 'instagram' | 'system';

/** `EXPO_PUBLIC_FB_APP_ID` wins over `expo.extra.facebookAppId`; blank counts as unset. */
export function resolveFacebookAppId(env: string | undefined, extra: string | undefined): string | null {
  const id = (env ?? '').trim() || (extra ?? '').trim();
  return id === '' ? null : id;
}

/** `transparent`: the PNG is a sticker (no background), which Instagram's sticker layer and the system sheet keep intact. */
export function instagramRoute(appId: string | null, os: ShareOs, transparent: boolean): InstagramRoute {
  if (appId) return 'stories';
  if (os === 'ios' && transparent) return 'system';
  return 'instagram';
}

/**
 * Saving to Photos. iOS asks for add-only access; Android 11+ writes through MediaStore without a permission. Android 10
 * would need the legacy storage permission, which the Play build leaves out, so Save is not offered there.
 */
export function canSaveToLibrary(os: ShareOs, androidApiLevel: number): boolean {
  return os === 'ios' || androidApiLevel >= 30;
}
