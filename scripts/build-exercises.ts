// `bun scripts/build-exercises.ts`: builds the bundled exercise library from the curated list in scripts/exercises/.
//
//   bun scripts/build-exercises.ts            fetch the sources into /tmp (first run only), then build
//   bun scripts/build-exercises.ts --refresh  fetch the sources again
//
// Reads (cached in /tmp/coach-exercises-src, never committed):
//   free-exercise-db   https://github.com/yuhonas/free-exercise-db  dist/exercises.json   The Unlicense (text data only:
//                      muscles and level; every sentence the user reads is written for this app).
//   wger images        https://wger.de/api/v2/exerciseimage/                              per-image CC licences.
//
// Writes:
//   src/features/coach/exercises/exercises.json        compact, typed by exercises/types.ts
//   site/public/exercises/<id>/<i>.webp                 480 px max, quality 72, at most 2 per exercise
//   site/public/exercises/ATTRIBUTION.txt               one record per image: author, licence, source page
//
// free-exercise-db's own images are NOT used: its README says nothing about where they come from, its maintainer
// writes "I actually have no idea where the images are from or if they are royalty free", and the upstream project
// (wrkout/exercises.json) states they were "scrapped off the internet". See NOTICE.
//
// Not a `package.json` script on purpose: `scripts` there is part of the OTA fingerprint (docs/ota.md).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import type { ExerciseDef, ExercisePattern, Muscle } from '../src/features/coach/exercises/types';
import { CORE_ARMS_CARDIO } from './exercises/core-arms-cardio';
import type { Cur, Curation } from './exercises/curation-types';
import { LOWER } from './exercises/lower';
import { PUSH_PULL } from './exercises/push-pull';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = '/tmp/coach-exercises-src';
const OUT_JSON = join(root, 'src/features/coach/exercises/exercises.json');
const OUT_IMAGES = join(root, 'site/public/exercises');
const refresh = process.argv.includes('--refresh');

const PATTERNS: ExercisePattern[] = ['squat', 'hinge', 'lunge', 'push_h', 'push_v', 'pull_h', 'pull_v', 'core', 'glute', 'calf', 'arms', 'cardio'];
const HOME_EQUIPMENT: Record<string, true> = { bodyweight: true, band: true, dumbbell: true };
const MAX_IMAGES = 2;

// ── sources ────────────────────────────────────────────────────────────────

interface SourceExercise {
  id: string;
  level: 'beginner' | 'intermediate' | 'expert';
  primaryMuscles: string[];
  secondaryMuscles: string[];
}
interface WgerImage {
  id: number;
  exercise: number;
  image: string;
  license: number;
  license_author: string;
  is_ai_generated: boolean;
}
interface WgerLicense {
  id: number;
  short_name: string;
  url: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function ensureSources(): Promise<{ fedb: Map<string, SourceExercise>; images: Map<number, WgerImage>; licenses: Map<number, WgerLicense> }> {
  mkdirSync(SRC, { recursive: true });
  const fedbFile = join(SRC, 'free-exercise-db.json');
  if (refresh || !existsSync(fedbFile)) {
    const res = await fetch('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json');
    if (!res.ok) throw new Error(`free-exercise-db: HTTP ${res.status}`);
    writeFileSync(fedbFile, Buffer.from(await res.arrayBuffer()));
  }
  const imagesFile = join(SRC, 'wger-images.json');
  if (refresh || !existsSync(imagesFile)) {
    const all: WgerImage[] = [];
    let url: string | null = 'https://wger.de/api/v2/exerciseimage/?limit=100&format=json';
    while (url) {
      const page: { next: string | null; results: WgerImage[] } = await getJson(url);
      all.push(...page.results);
      url = page.next;
    }
    writeFileSync(imagesFile, JSON.stringify(all));
  }
  const licensesFile = join(SRC, 'wger-licenses.json');
  if (refresh || !existsSync(licensesFile)) {
    const page = await getJson<{ results: WgerLicense[] }>('https://wger.de/api/v2/license/?format=json');
    writeFileSync(licensesFile, JSON.stringify(page.results));
  }
  const fedb = new Map((JSON.parse(readFileSync(fedbFile, 'utf8')) as SourceExercise[]).map((e) => [e.id, e]));
  const images = new Map((JSON.parse(readFileSync(imagesFile, 'utf8')) as WgerImage[]).map((e) => [e.id, e]));
  const licenses = new Map((JSON.parse(readFileSync(licensesFile, 'utf8')) as WgerLicense[]).map((e) => [e.id, e]));
  return { fedb, images, licenses };
}

async function imageBytes(img: WgerImage): Promise<Buffer> {
  const file = join(SRC, `wger-${img.id}.bin`);
  if (!existsSync(file)) {
    const res = await fetch(img.image);
    if (!res.ok) throw new Error(`${img.image}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file);
}

// ── mapping ────────────────────────────────────────────────────────────────

const MUSCLES: Record<string, Muscle> = {
  abdominals: 'abs', abductors: 'abductors', adductors: 'adductors', biceps: 'biceps', calves: 'calves', chest: 'chest', forearms: 'forearms',
  glutes: 'glutes', hamstrings: 'hamstrings', lats: 'lats', 'lower back': 'lower_back', 'middle back': 'middle_back', neck: 'neck',
  quadriceps: 'quadriceps', shoulders: 'shoulders', traps: 'traps', triceps: 'triceps',
};
const mapMuscles = (names: string[]): Muscle[] =>
  names.map((name) => {
    const muscle = MUSCLES[name];
    if (!muscle) throw new Error(`unknown muscle "${name}"`);
    return muscle;
  });

function fail(id: string, message: string): never {
  throw new Error(`${id}: ${message}`);
}

function toDef(cur: Cur, pattern: ExercisePattern, rank: number, fedb: Map<string, SourceExercise>): ExerciseDef {
  let source: SourceExercise | undefined;
  if (cur.src !== 'own') {
    source = fedb.get(cur.src);
    if (!source) fail(cur.id, `free-exercise-db has no "${cur.src}"`);
  }
  const level = cur.lvl ?? (source ? (source.level === 'expert' ? 'advanced' : source.level) : fail(cur.id, 'own entry needs lvl'));
  const primary = cur.p ?? (source ? mapMuscles(source.primaryMuscles) : fail(cur.id, 'own entry needs p'));
  const secondary = (cur.s ?? (source ? mapMuscles(source.secondaryMuscles) : fail(cur.id, 'own entry needs s'))).filter((m) => !primary.includes(m));
  if (primary.length === 0) fail(cur.id, 'no primary muscle');
  if (cur.se.length < 3 || cur.se.length > 6 || cur.si.length !== cur.se.length) fail(cur.id, 'steps: 3-6 and same count in both languages');
  if (cur.me.length < 2 || cur.me.length > 3 || cur.mi.length !== cur.me.length) fail(cur.id, 'mistakes: 2-3 and same count in both languages');
  for (const text of [...cur.se, ...cur.si, ...cur.me, ...cur.mi]) {
    if (!text.trim()) fail(cur.id, 'empty text');
    if (/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(text)) fail(cur.id, `emoji in "${text}"`);
  }
  for (const text of cur.se) if (text.includes('. ')) fail(cur.id, `step is more than one sentence: "${text}"`);
  const images = cur.img?.length ?? 0;
  if (images > MAX_IMAGES) fail(cur.id, `more than ${MAX_IMAGES} images`);
  return {
    id: cur.id,
    src: cur.src,
    name: { id: cur.idn, en: cur.en },
    pattern,
    equipment: cur.eq,
    home: cur.home ?? HOME_EQUIPMENT[cur.eq] === true,
    gym: true,
    level,
    primary,
    secondary,
    rank,
    timed: cur.timed ?? false,
    steps: { id: cur.si, en: cur.se },
    mistakes: { id: cur.mi, en: cur.me },
    images,
  };
}

// ── build ──────────────────────────────────────────────────────────────────

const curation: Curation[] = [LOWER, PUSH_PULL, CORE_ARMS_CARDIO];
const { fedb, images: wger, licenses } = await ensureSources();

const defs: ExerciseDef[] = [];
const curs = new Map<string, Cur>();
for (const pattern of PATTERNS) {
  const list = curation.flatMap((part) => part[pattern] ?? []);
  list.forEach((cur, index) => {
    if (curs.has(cur.id)) fail(cur.id, 'duplicate id');
    curs.set(cur.id, cur);
    defs.push(toDef(cur, pattern, index + 1, fedb));
  });
}
const declared = curation.reduce((n, part) => n + Object.values(part).reduce((m, list) => m + list.length, 0), 0);
if (declared !== defs.length) throw new Error('an exercise sits under a pattern that is not in PATTERNS');

rmSync(OUT_IMAGES, { recursive: true, force: true });
mkdirSync(OUT_IMAGES, { recursive: true });
const credits: string[] = [];
let imageCount = 0;
for (const def of defs) {
  const cur = curs.get(def.id)!;
  for (const [i, imageId] of (cur.img ?? []).entries()) {
    const img = wger.get(imageId);
    if (!img) fail(def.id, `wger has no image ${imageId}`);
    const license = licenses.get(img.license);
    if (!license) fail(def.id, `image ${imageId} has an unknown licence id ${img.license}`);
    if (img.is_ai_generated) fail(def.id, `image ${imageId} is AI generated`);
    if (!img.license_author.trim()) fail(def.id, `image ${imageId} has no recorded author`);
    mkdirSync(join(OUT_IMAGES, def.id), { recursive: true });
    await sharp(await imageBytes(img))
      .flatten({ background: '#ffffff' })
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(join(OUT_IMAGES, def.id, `${i}.webp`));
    imageCount += 1;
    credits.push(
      `${def.id}/${i}.webp  ${def.name.en}\n` +
        `  author   ${img.license_author}\n` +
        `  licence  ${license.short_name} (${license.url})\n` +
        `  source   https://wger.de/en/exercise/${img.exercise}/view  (image ${img.id}: ${img.image})\n` +
        `  changes  flattened onto white, scaled to at most 480 px, converted to WebP`,
    );
  }
}

writeFileSync(OUT_JSON, JSON.stringify(defs));
writeFileSync(
  join(OUT_IMAGES, 'ATTRIBUTION.txt'),
  [
    'JoyoFit exercise images',
    '',
    'The pictures in this folder come from wger (https://wger.de), where every image carries its own Creative Commons',
    'licence. Each one is listed below with its author, licence and source page. Adapted copies (flattened onto white,',
    'scaled down, converted to WebP) are shared under the same licence as the original.',
    '',
    ...credits.flatMap((entry) => [entry, '']),
  ].join('\n'),
);

const bytes = readFileSync(OUT_JSON).length;
console.log(`${defs.length} exercises, ${imageCount} images, exercises.json ${(bytes / 1024).toFixed(1)} KB`);
