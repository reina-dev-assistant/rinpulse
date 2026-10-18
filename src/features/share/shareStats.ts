/** How a sport reports its average effort: swimming per 100 m, running and walking per km, the rest as km/h. */
export type EffortKind = 'pace100m' | 'paceKm' | 'speed';

/** Matched against the watch's English sport name, like `sportIcon`. */
export function effortKind(sportName: string): EffortKind {
  if (/swim|diving|apnea|scuba/i.test(sportName)) return 'pace100m';
  if (/walk|hik|run|trail/i.test(sportName)) return 'paceKm';
  return 'speed';
}
