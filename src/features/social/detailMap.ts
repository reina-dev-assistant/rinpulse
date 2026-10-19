import type { RogoWorkoutDetail } from '@/cloud/rogo';

/** What the post screen knows about the analysis under the post's own map: not loaded yet, or loaded with a map in it or not. */
export type DetailMap = 'pending' | 'shown' | 'none';

/**
 * Whether the analysis (`social/workoutDetail`) draws its own route map. The full analysis draws one when its series has a
 * track point; the basic view when the route has two points. A locked answer draws nothing, so the post's own map stays.
 * The post screen hides the post's map (`mapLine`) while this is `pending` or `shown`: the same route twice is the bug.
 */
export function detailMapOf(detail: RogoWorkoutDetail): DetailMap {
  if (detail.locked) return 'none';
  if (detail.analysis) {
    const series = detail.analysis.series;
    return series && series.n >= 2 && series.track?.some((p) => p !== null) ? 'shown' : 'none';
  }
  return detail.route && detail.route.length >= 2 ? 'shown' : 'none';
}
