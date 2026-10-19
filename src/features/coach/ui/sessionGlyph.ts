import type { ChipGlyph } from '@/components/IconChip';
import type { SessionType } from '../plans/types';

/** The chip glyph of a session or of today's suggested activity: people for what is done on foot or with weights, symbols for pace work. */
export const SESSION_GLYPH: Record<SessionType | 'walk' | 'mobility', ChipGlyph> = {
  easy: { sport: 'run' },
  recovery: { icon: 'leaf' },
  long: { icon: 'trail-sign' },
  tempo: { icon: 'speedometer' },
  intervals: { icon: 'flash' },
  walkrun: { icon: 'footsteps' },
  race: { icon: 'trophy' },
  strength: { sport: 'weight-lifter' },
  walk: { sport: 'walk' },
  mobility: { sport: 'yoga' },
};
