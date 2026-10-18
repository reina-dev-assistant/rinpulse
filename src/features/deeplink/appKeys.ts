import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved at load: the router tests swap the global `URL` for the phone's.
const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/** The keys Expo Router's require.context gives for `src/app` (`./strength/index.tsx`), read from disk for tests. */
export function appKeys(): string[] {
  const walk = (dir: string, base: string): string[] =>
    readdirSync(dir).flatMap((name) =>
      statSync(join(dir, name)).isDirectory() ? walk(join(dir, name), `${base}${name}/`) : [`${base}${name}`],
    );
  return walk(APP_DIR, './').filter((key) => /\.[tj]sx?$/.test(key));
}
