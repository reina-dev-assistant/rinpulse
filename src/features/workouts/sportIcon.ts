import type { SportIconName } from '@/components/SportIcon';
import type { SportKind } from '@/features/workouts/analysis/types';

/**
 * First match wins, so the specific names come before the broad ones ("Pool Swimming" is a swim, a bare "Pool" is billiards;
 * "Mountain Hike" is a hike, not a walk). Keys are matched against the watch's English sport name.
 */
const RULES: readonly [RegExp, SportIconName][] = [
  [/swim/i, 'swim'],
  [/diving|apnea|scuba|snorkel/i, 'diving-scuba'],
  [/hik|orienteer/i, 'hiking'],
  [/walk/i, 'walk'],
  [/high-intensity|hiit/i, 'run-fast'],
  [/run|trail|treadmill|obstacle/i, 'run'],
  [/cycl|spinning|bik|\bride\b|bmx/i, 'bike'],
  [/jump(?:ing)? rope|skipping/i, 'jump-rope'],
  [/ping pong|table tennis/i, 'table-tennis'],
  [/badminton|shuttlecock/i, 'badminton'],
  [/tennis|padel|squash/i, 'tennis'],
  [/soccer|futsal/i, 'soccer'],
  [/football/i, 'football'],
  [/basketball/i, 'basketball'],
  [/volleyball|sepak/i, 'volleyball'],
  [/handball/i, 'handball'],
  [/baseball|softball/i, 'baseball'],
  [/cricket/i, 'cricket'],
  [/rugby/i, 'rugby'],
  [/hockey/i, 'hockey-sticks'],
  [/golf/i, 'golf'],
  [/bowling/i, 'bowling'],
  [/^pool$|billiard|snooker/i, 'billiards'],
  [/archery|darts/i, 'bullseye-arrow'],
  [/esports/i, 'gamepad-variant'],
  [/yoga|pilates|stretch/i, 'yoga'],
  [/tai chi|meditat/i, 'meditation'],
  [/kayak|canoe|rafting|dragon boat|paddle/i, 'kayaking'],
  [/\brow/i, 'rowing'],
  [/sailing/i, 'sail-boat'],
  [/surfing/i, 'surfing'],
  [/fishing/i, 'fish'],
  [/boxing|sparring|combat/i, 'boxing-glove'],
  [/karate|taekwondo|kendo|judo|martial/i, 'karate'],
  [/fencing/i, 'fencing'],
  [/dance|dancing|ballet/i, 'dance-ballroom'],
  [/roller skating|inline/i, 'roller-skate'],
  [/skateboard/i, 'skateboarding'],
  [/ice skating/i, 'skate'],
  [/snowboard/i, 'snowboard'],
  [/\bski|biathlon/i, 'ski'],
  [/sled|bobsleigh/i, 'sledding'],
  [/horse/i, 'horse-human'],
  [/parachut/i, 'parachute'],
  [/kite/i, 'kite'],
  [/auto racing/i, 'flag-checkered'],
  [/horizontal bar|parallel bars|gymnastic/i, 'gymnastics'],
  [/stepper|stairs/i, 'stairs'],
  [/strength|weight|crossfit|functional|physical training|core training|barbell/i, 'weight-lifter'],
];

/** What a `SportKind` is drawn as when the name itself says nothing, e.g. a post titled "Lari" or "Bersepeda". */
const KIND_ICON: Partial<Record<SportKind, SportIconName>> = { run: 'run', walk: 'walk', ride: 'bike', swim: 'swim' };

/**
 * Pictogram for a workout, by sport name. A name no rule knows falls back to its `kind` when the caller has one, then to a heart
 * with a pulse line.
 */
export function sportIcon(sportName: string, kind?: SportKind): SportIconName {
  return RULES.find(([pattern]) => pattern.test(sportName))?.[1] ?? (kind && KIND_ICON[kind]) ?? 'heart-pulse';
}
