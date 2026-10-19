import { useCallback, useEffect, useMemo } from 'react';

import { rogo } from '@/cloud/rogo';
import { Notice, Skeleton } from '@/components/States';
import { ProUpsell } from '@/features/social/ProUpsell';
import { detailMapOf, type DetailMap } from '@/features/social/detailMap';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { useAnalysisPalette, useMapTheme } from '@/features/workouts/analysis/palette';
import { BasicDetail, WorkoutAnalysisView, useAnalysisT } from '@/features/workouts/analysis/ui';

/**
 * The analysis of a watch post (`stats.hasDetail === 1`): map, charts, splits, zones and more; a legacy post that only has
 * a heart-rate series and a route gets the basic view. JoyoRogo decides who sees it: the author and Pro viewers get the
 * data, everyone else `locked` and the Pro upsell. `onScrubActive` lets the screen freeze its scroll while a chart is touched.
 * `onMap` says whether the analysis draws its own route map, so the screen does not draw the post's map a second time.
 */
export function WorkoutDetailSection({
  postId,
  onScrubActive,
  onMap,
}: {
  postId: string;
  onScrubActive?: (active: boolean) => void;
  onMap?: (map: DetailMap) => void;
}) {
  const load = useCallback(() => rogo.social.workoutDetail(postId), [postId]);
  const { data, error } = useRogoQuery(load, true);
  useEffect(() => {
    if (data) onMap?.(detailMapOf(data));
    else if (error !== null) onMap?.('none');
  }, [data, error, onMap]);
  const analysisT = useAnalysisT();
  const palette = useAnalysisPalette();
  const mapTheme = useMapTheme();
  // BasicDetail reads a 0 as a gap.
  const hr = useMemo(() => (data?.hr ? { intervalSec: data.hr.intervalSec, bpm: data.hr.bpm.map((b) => b ?? 0) } : null), [data]);

  if (!data) {
    return error !== null ? <Notice tone="danger">{error}</Notice> : <Skeleton width="100%" height={320} radius="card" />;
  }
  if (data.locked) return <ProUpsell />;
  if (data.analysis) {
    return <WorkoutAnalysisView analysis={data.analysis} palette={palette} t={analysisT} mapTheme={mapTheme} onScrubActive={onScrubActive} />;
  }
  if (data.hr || data.route) {
    return <BasicDetail hr={hr} route={data.route} palette={palette} t={analysisT} mapTheme={mapTheme} />;
  }
  return null;
}
