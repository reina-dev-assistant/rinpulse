import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { Linking } from 'react-native';
import Share from 'react-native-share';

import { OS, ensurePhotosAccess, isShareCancel, type PhotosPrompt } from './shareImage';
import { THREADS_PACKAGE, threadsComposerUrl } from './shareThreadsUrl';

export { threadsComposerUrl } from './shareThreadsUrl';

/**
 * Whether the Threads app is on the phone: `true` or `false` on Android (package manager), `null` when it cannot be told.
 * iOS cannot ask: `canOpenURL('threads://')` answers `false` for every scheme not listed in `LSApplicationQueriesSchemes`, and the
 * react-native-share plugin entry of `app.json` lists only Instagram's. Android 11+ hides packages the manifest `<queries>` does
 * not name, so the answer is only as good as that list.
 */
export async function threadsInstalled(): Promise<boolean | null> {
  if (OS === 'ios') return null;
  try {
    return (await Share.isPackageInstalled(THREADS_PACKAGE)).isInstalled;
  } catch {
    return null;
  }
}

/**
 * Opens the system share sheet with every PNG and the caption. Android sends ACTION_SEND_MULTIPLE with the text as EXTRA_TEXT
 * (Threads is in the chooser), iOS a share sheet with all the images. Whether Threads fills its composer from EXTRA_TEXT when
 * images come along is not documented, so the caption is also put on the clipboard first: the person can paste it. Resolves
 * quietly when the person closes the sheet.
 */
export async function shareThreadsCarousel(fileUris: readonly string[], caption: string): Promise<void> {
  await Clipboard.setStringAsync(caption);
  try {
    await Share.open({ urls: [...fileUris], type: 'image/png', message: caption, failOnCancel: false });
  } catch (error) {
    if (!isShareCancel(error)) throw error;
  }
}

/**
 * The route that works everywhere: every PNG goes to the photo library, the caption to the clipboard, and the Threads composer
 * opens with the text filled in; the person taps its photo button and picks the saved images. Resolves `false` when the person
 * declines the Photos pre-prompt (nothing was saved); throws `PhotosDeniedError` when Photos access is refused.
 */
export async function saveAllAndOpenThreads(fileUris: readonly string[], caption: string, prompt: PhotosPrompt): Promise<boolean> {
  if (!(await ensurePhotosAccess('save', prompt))) return false;
  for (const uri of fileUris) await MediaLibrary.Asset.create(uri);
  await Clipboard.setStringAsync(caption);
  await Linking.openURL(threadsComposerUrl(caption));
  return true;
}
