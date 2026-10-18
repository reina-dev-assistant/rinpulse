// `bun scripts/i18n-check.ts`: translation completeness and leftover UI literals (app and server).
//
//   bun scripts/i18n-check.ts            key parity + hard-coded UI text; exit 1 on any finding
//   bun scripts/i18n-check.ts --list     also list unused keys (informational)
//
// 1. Key parity: every key of the source language (id) exists in en (plural-aware), and en has no orphans.
//    The same for server/src/i18n.
// 2. Literals: JSX text and user-facing props (title, label, placeholder, ...) holding a letter-bearing string
//    literal, and Alert/toast style calls, in src/ outside tests and fixtures. They must go through t().
//    A line ending in `// i18n-ok` (reason after it) is exempt: product names, protocol/debug text.
//
// Not a `package.json` script on purpose: `scripts` is part of the OTA fingerprint (docs/ota.md), so editing it
// would change the runtimeVersion and strand the installed apps.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { missingKeys, orphanKeys, sourceKeys } from '../src/i18n/keys';
import { LOCALES } from '../src/i18n/locale';

const root = fileURLToPath(new URL('..', import.meta.url));
const list = process.argv.includes('--list');
let failed = false;

// ── 1. keys ────────────────────────────────────────────────────────────────

console.log('Translation keys (app)');
for (const locale of LOCALES) {
  if (locale === 'id') continue;
  const missing = missingKeys(locale);
  const orphan = orphanKeys(locale);
  console.log(`  ${locale}: ${missing.length} missing, ${orphan.length} orphan (source: ${sourceKeys().length} keys)`);
  for (const key of missing) console.log(`    missing  ${key}`);
  for (const key of orphan) console.log(`    orphan   ${key}`);
  if (missing.length || orphan.length) failed = true;
}

const serverResult = spawnSync('bun', ['run', join(root, 'server/scripts/i18n-keys.ts')], { encoding: 'utf8' });
process.stdout.write(serverResult.stdout);
process.stderr.write(serverResult.stderr);
if (serverResult.status !== 0) failed = true;

// ── 2. literals ─────────────────────────────────────────────────────────────

const SKIP_DIR = new Set(['node_modules', 'locales', '__fixtures__']);
/**
 * The sticker engine core is shared byte-for-byte with JoyoRogo, so it cannot carry `// i18n-ok` marks; its strings are
 * developer-facing issue messages, never shown to people. Its tests and tools are not UI either. Templates hold `{path|filter}`
 * bindings, not words; `templates.test.ts` fails on any letter outside a binding or an i18n key.
 */
const SKIP_PATH = /src[\\/]features[\\/]stickers[\\/](core|testing|tools|templates)$/;
const SKIP_FILE = /(\.test\.[tj]sx?|\.d\.ts|[Ff]ixtures?\.tsx?)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIR.has(name) && !SKIP_PATH.test(path)) yield* walk(path);
    } else if (/\.tsx?$/.test(name) && !SKIP_FILE.test(name)) {
      yield path;
    }
  }
}

const PROPS =
  'title|label|placeholder|description|subtitle|caption|message|alt|hint|heading|helper|helperText|emptyTitle|emptyText|cta|confirmLabel|cancelLabel|actionLabel|accessibilityLabel|accessibilityHint|tabBarLabel|headerTitle|tagline|body|detail|note|text|value|unit|suffix|prefix';
const STR = `(?:"((?:[^"\\\\\\n]|\\\\.)*)"|'((?:[^'\\\\\\n]|\\\\.)*)')`;
// <Comp title="x">, title: 'x', and the braced form title={'x'}.
const PROP_RE = new RegExp(`(?:^|[\\s{(,])(?:${PROPS})\\s*(?:=\\s*\\{?|:)\\s*${STR}`, 'g');
const CALL_RE = new RegExp(`\\b(?:Alert\\.alert|alert|toast(?:\\.\\w+)?|notify|showToast)\\(\\s*${STR}`, 'g');
// JSX text: between a tag's `>` and the next `<` or `{`.
const JSX_TEXT_RE = />([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)(?=<|\{)/g;

/** Looks like prose: has a letter-run of 2+ and is not an identifier, path, url, enum token or format spec. */
/** Names and identifiers that read the same in every language. */
const UNTRANSLATED = /^(JoyoFit|JoyoRogo|Strava|Huawei|Honor|Instagram|Apple Health|Health Connect|Open-Meteo|AGPL-3\.0-or-later|OpenStreetMap|GPX|TCX|FIT|Wi-Fi|WiFi|Bluetooth|BLE)$/;

function isProse(text: string): boolean {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (UNTRANSLATED.test(clean)) return false;
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(clean)) return false;
  if (/^[a-z][\w.-]*$/.test(clean)) return false;
  if (/^[a-zA-Z0-9_$.]+(\(|,)/.test(clean) || /\bt\(/.test(clean)) return false; // code, not copy // identifier / enum / key: "steps", "heart-rate", "a.b"
  if (/^[A-Z0-9_]+$/.test(clean)) return false; // CONSTANT
  if (/^(https?:|[./#@]|\w+:\/\/)/.test(clean)) return false;
  if (/^[\w-]+(\/[\w.-]+)+$/.test(clean)) return false; // path
  if (/^[#%0-9a-fA-F.,()\s]+$/.test(clean)) return false;
  return true;
}

type Hit = { file: string; line: number; text: string };
const hits: Hit[] = [];

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

for (const file of walk(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const add = (index: number, text: string) => {
    if (!isProse(text)) return;
    const line = lineOf(source, index);
    if (/i18n-ok/.test(lines[line - 1] ?? '')) return;
    hits.push({ file: relative(root, file), line, text: text.replace(/\s+/g, ' ').trim() });
  };
  const regexes = [PROP_RE, CALL_RE];
  for (const re of regexes) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) add(m.index, m[1] ?? m[2] ?? '');
  }
  if (file.endsWith('.tsx')) {
    JSX_TEXT_RE.lastIndex = 0;
    for (let m = JSX_TEXT_RE.exec(source); m; m = JSX_TEXT_RE.exec(source)) {
      const text = m[1] ?? '';
      const after = source.slice(m.index + m[0].length, m.index + m[0].length + 2);
      // `=>` / `->` arrows and generics (`Promise<void>`, `Array<T>`) are code, not JSX.
      if (/[=-]/.test(source[m.index - 1] ?? '')) continue;
      if (after !== '</' && !/\s/.test(text.trim())) continue;
      if (/\s[:?]\s/.test(text)) continue; // ternary
      if (/[;=()[\]]|&&|\|\||=>|\?\.|[,:({]\s*$|^\s*[,:]|\)\s*[,;:?]/.test(text)) continue;
      add(m.index, text);
    }
  }
}

console.log(`\nHard-coded UI text in src/: ${hits.length} literal(s)`);
for (const hit of hits) console.log(`  ${hit.file}:${hit.line}  ${hit.text.slice(0, 90)}`);
if (hits.length) failed = true;

if (list) {
  console.log('\nKeys never referenced as a string (informational)');
  const corpus: string[] = [];
  for (const file of walk(join(root, 'src'))) corpus.push(readFileSync(file, 'utf8'));
  const text = corpus.join('\n');
  for (const key of sourceKeys()) {
    const path = key.split(':')[1]!.replace(/_(zero|one|two|few|many|other)$/, '');
    const last = path.split('.').slice(-2).join('.');
    if (!text.includes(path) && !text.includes(last)) console.log(`  ${key}`);
  }
}

process.exit(failed ? 1 : 0);
