import { describe, expect, it } from 'bun:test';

import { AUTO_STRAVA_WINDOW_MS, autoStravaWanted } from './autoStrava';
import type { StrengthWorkout } from './types';

const NOW = 1_790_000_000_000;
const workout = (over: Partial<StrengthWorkout> = {}): StrengthWorkout => ({
  id: 'w1',
  name: 'Push',
  startedAt: NOW - 3_600_000,
  endedAt: NOW - 600_000,
  durationSec: 3000,
  note: '',
  routineId: null,
  planKey: null,
  exercises: [],
  workoutStart: 1_790_000_000,
  kcal: 200,
  kcalSource: 'estimate',
  updatedAt: 1,
  deletedAt: null,
  ...over,
});
const on = { setting: true, connected: true, alreadySent: false };

describe('autoStravaWanted', () => {
  it('a workout just finished goes when the setting is on and Strava is connected', () => {
    expect(autoStravaWanted(workout(), on, NOW)).toBe(true);
  });

  it('needs the setting, the connection and a workout Strava has not got', () => {
    expect(autoStravaWanted(workout(), { ...on, setting: false }, NOW)).toBe(false);
    expect(autoStravaWanted(workout(), { ...on, connected: false }, NOW)).toBe(false);
    expect(autoStravaWanted(workout(), { ...on, alreadySent: true }, NOW)).toBe(false);
  });

  it('an old workout edited later, a deleted one, imported history and one without a row stay off Strava', () => {
    expect(autoStravaWanted(workout({ endedAt: NOW - AUTO_STRAVA_WINDOW_MS - 1 }), on, NOW)).toBe(false);
    expect(autoStravaWanted(workout({ deletedAt: NOW }), on, NOW)).toBe(false);
    expect(autoStravaWanted(workout({ id: 'rogo:abc' }), on, NOW)).toBe(false);
    expect(autoStravaWanted(workout({ workoutStart: null }), on, NOW)).toBe(false);
  });
});
