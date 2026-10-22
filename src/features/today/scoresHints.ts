import type { RecoveryWait } from '@/features/today/recovery';
import { t } from '@/i18n';

/** What one Today gauge says when it has no number yet: the cause in a few words, and how far along it is when that can be counted. */
export interface GaugeWait {
  /** Short cause or remaining requirement, under the label. */
  caption: string;
  /** Centre of the ring: `have/need` while a count is filling, otherwise null (the ring keeps its `--`). */
  center: string | null;
  /** 0..1 share of the requirement met; null when nothing can be counted. */
  progress: number | null;
}

/** The recovery gauge's wait. `withPrefix` names what is missing when the ring shows the readiness word instead of recovery. */
export function recoveryWaitHint(wait: RecoveryWait, withPrefix: boolean): GaugeWait {
  const say = (hint: string) => (withPrefix ? t('today:scores.hint.recoveryPrefix', { hint }) : hint);
  switch (wait.kind) {
    case 'baseline': {
      const left = Math.max(1, wait.need - wait.have);
      return {
        caption: say(t(wait.unit === 'night' ? 'today:scores.hint.nights' : 'today:scores.hint.readings', { count: left })),
        center: `${wait.have}/${wait.need}`,
        progress: Math.min(1, wait.have / wait.need),
      };
    }
    case 'off':
      return { caption: say(t('today:scores.hint.hrvOff')), center: null, progress: null };
    case 'spot':
      return { caption: say(t('today:scores.hint.spot')), center: null, progress: null };
    case 'none':
      return { caption: say(t('today:scores.hint.recoveryNone')), center: null, progress: null };
  }
}

export const strainWaitHint = (): GaugeWait => ({ caption: t('today:scores.hint.strainNone'), center: null, progress: null });

export const sleepWaitHint = (): GaugeWait => ({ caption: t('today:scores.hint.sleepNone'), center: null, progress: null });
