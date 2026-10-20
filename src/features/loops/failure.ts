/** The words for a loop search that came back empty: the service, the start or the target length, whichever it was. Pure. */
import { formatRouteDistance } from '@/features/routes/routeModel';
import { t } from '@/i18n';

import { LoopError, type LoopCandidate, type LoopFailure } from './generate';

const KEY: Record<LoopFailure, 'noRoad' | 'noLoop' | 'busy' | 'network'> = {
  no_road: 'noRoad',
  no_loop: 'noLoop',
  busy: 'busy',
  network: 'network',
};

export interface FailureText {
  message: string;
  /** The nearest loop that was routed, to offer anyway; only when the target length is what did not fit. */
  closest: LoopCandidate | null;
}

export function failureMessage(error: unknown, targetM: number): FailureText {
  if (!(error instanceof LoopError)) return { message: t('loops:errors.network'), closest: null };
  if (error.kind !== 'no_loop') return { message: t(`loops:errors.${KEY[error.kind]}`), closest: null };
  const { closest } = error;
  const target = formatRouteDistance(targetM);
  if (closest === null) return { message: t('loops:errors.noLoop', { target }), closest };
  const percent = Math.round(Math.abs(closest.lengthError) * 100);
  const key = closest.lengthError > 0 ? 'noLoopLong' : 'noLoopShort';
  return { message: t(`loops:errors.${key}`, { target, closest: formatRouteDistance(closest.lengthM), percent }), closest };
}
