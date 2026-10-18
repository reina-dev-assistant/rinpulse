/** Arrow for a turn cue: an Ionicons glyph and how many degrees to rotate it. Pure data, shared by the map strip and the field cell. */
import type { TurnKind } from '../types';

export interface TurnArrow {
  icon: 'arrow-up' | 'arrow-undo' | 'flag' | 'play';
  rotateDeg: number;
}

const ARROWS: Record<TurnKind, TurnArrow> = {
  slightLeft: { icon: 'arrow-up', rotateDeg: -45 },
  left: { icon: 'arrow-up', rotateDeg: -90 },
  sharpLeft: { icon: 'arrow-up', rotateDeg: -135 },
  slightRight: { icon: 'arrow-up', rotateDeg: 45 },
  right: { icon: 'arrow-up', rotateDeg: 90 },
  sharpRight: { icon: 'arrow-up', rotateDeg: 135 },
  uTurn: { icon: 'arrow-undo', rotateDeg: 0 },
  start: { icon: 'play', rotateDeg: 0 },
  finish: { icon: 'flag', rotateDeg: 0 },
};

export const turnArrow = (kind: TurnKind): TurnArrow => ARROWS[kind];
