/** The families of the field picker, in the order they are listed. Pure data; the group titles are `bikecomp:picker.group.<key>`. */
import type { FieldId } from '../types';

export type FieldGroupKey = 'speed' | 'hr' | 'power' | 'distance' | 'terrain' | 'other';

export const FIELD_GROUPS: readonly { key: FieldGroupKey; fields: readonly FieldId[] }[] = [
  { key: 'speed', fields: ['speed', 'avgSpeed', 'maxSpeed', 'lapSpeed'] },
  { key: 'hr', fields: ['hr', 'avgHr', 'hrZone', 'cadence', 'avgCadence'] },
  { key: 'power', fields: ['power', 'power3s', 'power10s', 'avgPower', 'normPower', 'powerZone', 'estPower'] },
  {
    key: 'distance',
    fields: ['distance', 'lapDistance', 'distanceToFinish', 'distanceToTurn', 'movingTime', 'elapsedTime', 'lapTime', 'timeOfDay', 'eta'],
  },
  { key: 'terrain', fields: ['altitude', 'ascent', 'descent', 'grade', 'climbRemaining'] },
  { key: 'other', fields: ['calories', 'battery'] },
];
