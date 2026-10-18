/** The pure half of the Threads share: no React Native, so `bun test` covers it. */
import { THREADS_TEXT_MAX } from '../threads/caption';

/** Threads' web composer: text only, opens the app when it is installed (the person adds the images there). */
export const THREADS_COMPOSER = 'https://www.threads.com/intent/post';

/** Android package of the Threads app (`BarcelonaShareHandlerActivity` takes ACTION_SEND text and images). */
export const THREADS_PACKAGE = 'com.instagram.barcelona';

/** `text` cut to the Threads limit by characters, never through the middle of a surrogate pair (an emoji). */
export function clipThreadsText(text: string): string {
  if (text.length <= THREADS_TEXT_MAX) return text;
  return Array.from(text).slice(0, THREADS_TEXT_MAX).join('');
}

/** The composer URL with `caption` pre-filled: percent-encoded and clipped to 500 characters. */
export function threadsComposerUrl(caption: string): string {
  return `${THREADS_COMPOSER}?text=${encodeURIComponent(clipThreadsText(caption))}`;
}
