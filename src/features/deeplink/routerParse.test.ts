// What Expo Router itself does with a joyofit:// link: its own URL-to-path step (`extractExpoPathFromURL`) and its own
// matcher (`getStateFromPath`), run over the route files of src/app as they are now and as they were before the
// strength screens existed. Needs only a stub of react-native: the matcher module imports it for platform code it
// does not use here.
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

import { appKeys } from './appKeys';
import { mapDeepLink, routePatterns } from './mapDeepLink';
import { LIVE_URL } from '../record/liveRoute';

mock.module('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  StyleSheet: { create: (x: unknown) => x },
  Linking: {},
}));

type State = { routes: { name: string; params?: Record<string, unknown>; state?: State }[] } | undefined;
type Parse = (path: string) => string;

/** The screens a state opens, root to leaf: `__root/strength/index`; `+not-found` when nothing matched. */
function leaf(state: State): { screen: string; params: Record<string, unknown> | undefined } {
  const names: string[] = [];
  let params: Record<string, unknown> | undefined;
  for (let s = state; s?.routes.length; s = s.routes[0].state) {
    names.push(s.routes[0].name);
    params = s.routes[0].params;
  }
  return { screen: names.join('/'), params };
}

let makeParser: (keys: string[]) => Promise<(url: string) => ReturnType<typeof leaf>>;

beforeAll(() => {
  makeParser = async (keys) => {
    const { inMemoryContext } = await import('expo-router/build/testing-library/context-stubs');
    const { getRoutes } = await import('expo-router/build/getRoutes');
    const { getReactNavigationConfig } = await import('expo-router/build/getReactNavigationConfig');
    const { getStateFromPath } = await import('expo-router/build/fork/getStateFromPath');
    const { extractExpoPathFromURL } = await import('expo-router/build/fork/extractPathFromURL');
    const files = keys.filter((k) => !k.includes('+native-intent'));
    const context = inMemoryContext(Object.fromEntries(files.map((k) => [k, () => null])));
    const routes = getRoutes(context, { ignoreEntryPoints: true, platform: 'ios' } as never)!;
    const config = { screens: { __root: { path: '', ...getReactNavigationConfig(routes, true) } } };
    return (url) => leaf(getStateFromPath(extractExpoPathFromURL([], url), config as never, []) as State);
  };
});

const nativeURL = globalThis.URL;

/** Hermes gets `URL` from expo's winter runtime (whatwg-url-minimum); Bun has its own. Both must agree. */
for (const impl of ['bun URL', 'whatwg-url-minimum (what the phone runs)'] as const) {
  describe(`expo-router parsing, ${impl}`, () => {
    afterAll(() => {
      globalThis.URL = nativeURL;
    });
    beforeAll(async () => {
      globalThis.URL = impl === 'bun URL' ? nativeURL : ((await import('whatwg-url-minimum')).URL as typeof URL);
    });

    test('joyofit://strength: "strength" is the URL host, and the router still finds /strength on iOS-style and Android-style strings', async () => {
      const parse = await makeParser(appKeys());
      for (const url of ['joyofit://strength', 'joyofit:///strength', 'joyofit://strength/']) {
        expect(parse(url).screen).toBe('__root/strength/index');
      }
      expect(parse('joyofit://strength/history').screen).toBe('__root/strength/history');
    });

    test('a bundle without the strength files cannot match it: that is the "Unmatched Route" page, whatever the URL form', async () => {
      const parse = await makeParser(appKeys().filter((k) => !k.startsWith('./strength/')));
      for (const url of ['joyofit://strength', 'joyofit:///strength', 'joyofit://app/strength']) {
        expect(parse(url).screen).toBe('__root/+not-found');
      }
    });

    test('joyofit://?open=strength: Today on a bundle without /strength, the strength home once mapped on one with it', async () => {
      const older = await makeParser(appKeys().filter((k) => !k.startsWith('./strength/')));
      expect(older('joyofit://?open=strength').screen).toBe('__root/index');

      const keys = appKeys();
      const current = await makeParser(keys);
      const mapped = mapDeepLink('joyofit://?open=strength', routePatterns(keys));
      expect(current(mapped).screen).toBe('__root/strength/index');
    });

    test('every form the app documents lands on its screen after mapping', async () => {
      const keys = appKeys();
      const parse = await makeParser(keys);
      const patterns = routePatterns(keys);
      const open = (url: string) => parse(mapDeepLink(url, patterns));
      expect(open('joyofit://').screen).toBe('__root/index');
      expect(open('joyofit:///').screen).toBe('__root/index');
      expect(open('joyofit:///today').screen).toBe('__root/today');
      expect(open('joyofit://settings/strava').screen).toBe('__root/settings/strava');
      expect(open('joyofit://family/accept?code=ABCD2345').params).toMatchObject({ code: 'ABCD2345' });
      expect(open('joyofit://strength/summary/abc').screen).toBe('__root/strength/summary/[id]');
      expect(open('joyofit://workout-live').screen).toBe('__root/workout-live');
      expect(open(LIVE_URL).screen).toBe('__root/workouts/record');
      expect(open('joyofit:///workouts/record').screen).toBe('__root/workouts/record');
    });

    test('an unknown link is Today, never +not-found', async () => {
      const keys = appKeys();
      const parse = await makeParser(keys);
      const patterns = routePatterns(keys);
      for (const url of ['joyofit://nope', 'joyofit://strength/nope', 'joyofit://app/strength', 'joyofit://?open=nope']) {
        expect(parse(mapDeepLink(url, patterns)).screen).toBe('__root/index');
      }
    });
  });
}
