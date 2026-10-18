import { ctx } from 'expo-router/_ctx';

import { mapDeepLink, routePatterns } from '@/features/deeplink/mapDeepLink';
import { readHead } from '@/features/sharedfile/readHead';
import { classifyByName, screenFor, sniffKind } from '@/features/sharedfile/routeSharedFile';

let routes: string[] | null | undefined;

/** The routes of this bundle, read from the router's own file list on first use; null (links are shaped, not judged) if it cannot be read. */
function knownRoutes(): string[] | null {
  if (routes === undefined) {
    try {
      routes = routePatterns(ctx.keys());
    } catch {
      routes = null;
    }
  }
  return routes;
}

/**
 * Every URL that opens JoyoFit passes through here before Expo Router matches it.
 *
 * A file opened with or shared to JoyoFit arrives as a `content://` (Android) or `file://` (iOS) URL. Expo Router would
 * look for a route with that path and show "unmatched route", so the URL goes to an import screen instead: a Huawei
 * Privacy Centre export `.zip` to the Huawei import, a `.gpx` or `.tcx` route to the route import, a `.fit` file (and
 * anything unclear) to the FIT import. The extension decides first; when the name says nothing (a download provider's
 * `msf:123`, an octet-stream attachment, a generic `application/xml`) the first bytes do. On Android a shared file is
 * first turned into a view intent by `plugins/with-shared-fit.js`.
 *
 * A `joyofit://` link is normalised by `mapDeepLink`: host and path forms reach the same route, and a link to a screen
 * this bundle does not have opens Today instead of the "Unmatched Route" page. Other URLs are left alone.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (/^(content|file):\/\//i.test(path)) {
    const named = classifyByName(path);
    const kind = named !== 'unknown' ? named : sniffKind(readHead(path) ?? new Uint8Array(0));
    return screenFor(path, kind);
  }
  return mapDeepLink(path, knownRoutes());
}
