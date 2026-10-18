/**
 * Incoming `joyofit://` links, normalised before Expo Router matches them (`src/app/+native-intent.ts`). Every form of the
 * same address lands on the same route, and an address no screen answers to lands on Today instead of the router's
 * "Unmatched Route" page:
 *
 *   joyofit://strength       host form (what people and JoyoRogo write; "strength" is the URL host, not a path)
 *   joyofit:///strength      path form
 *   joyofit://strength/      trailing slash
 *   joyofit://?open=strength the form JoyoRogo uses: an app that has no `/strength` yet (an older bundle) shows Today
 *                            for it, because the query reaches the index route as a parameter; an app that has it opens it
 *
 * Only the `joyofit:` scheme is touched. Everything else (https links, the dev client's `exp+joyofit://` launcher, files)
 * is returned as it came.
 */

const OWN_SCHEME = /^joyofit:/i;

/** The query parameter that names a route when the address has no path of its own. */
export const OPEN_PARAM = 'open';

/** Route patterns (`strength/summary/[id]`) from the keys of Expo Router's context (`./strength/summary/[id].tsx`). */
export function routePatterns(keys: readonly string[]): string[] {
  const patterns = new Set<string>();
  for (const key of keys) {
    const segments = key
      .replace(/^\.\//, '')
      .replace(/(\.(android|ios|native|web))?\.[tj]sx?$/, '')
      .split('/');
    const last = segments[segments.length - 1];
    if (last.startsWith('_layout') || last.startsWith('+')) continue;
    if (last === 'index') segments.pop();
    const route = segments.filter((s) => !/^\(.*\)$/.test(s)).join('/');
    if (route) patterns.add(route);
  }
  return [...patterns];
}

function matches(segments: readonly string[], pattern: string): boolean {
  const parts = pattern.split('/');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('[[...')) return true;
    if (part.startsWith('[...')) return segments.length > i;
    if (i >= segments.length) return false;
    if (!part.startsWith('[') && part !== segments[i]) return false;
  }
  return segments.length === parts.length;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const split = (path: string) => path.split('/').filter(Boolean);

/**
 * `/route?query` for a `joyofit:` link, `/` when no screen answers to it, the input unchanged for any other scheme.
 * `patterns` null means the route list is unavailable: shape the link but do not judge it.
 */
export function mapDeepLink(url: string, patterns: readonly string[] | null): string {
  if (!OWN_SCHEME.test(url)) return url;
  const body = url.replace(OWN_SCHEME, '').split('#')[0];
  const queryAt = body.indexOf('?');
  let segments = split(queryAt < 0 ? body : body.slice(0, queryAt));
  const pairs = queryAt < 0 ? [] : body.slice(queryAt + 1).split('&').filter(Boolean);

  const kept: string[] = [];
  let open: string | null = null;
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (segments.length === 0 && open === null && eq > 0 && pair.slice(0, eq) === OPEN_PARAM) open = decode(pair.slice(eq + 1));
    else kept.push(pair);
  }
  if (open !== null) segments = split(open);

  if (segments.length > 0 && patterns && !patterns.some((p) => matches(segments, p))) return '/';
  return `/${segments.join('/')}${kept.length > 0 ? `?${kept.join('&')}` : ''}`;
}
