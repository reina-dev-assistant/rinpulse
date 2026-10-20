import { describe, expect, it } from 'bun:test';

import { countGroups, effectiveFilter, parseView, visibleFilters, workoutGroup, type WorkoutGroup } from './filter';

describe('workoutGroup', () => {
  it('maps sport names to their chip', () => {
    const cases: [string, WorkoutGroup][] = [
      ['Running', 'run'],
      ['Trail Running', 'run'],
      ['Outdoor Walking', 'walk'],
      ['Hiking', 'walk'],
      ['Cycling', 'ride'],
      ['Indoor Cycling', 'ride'],
      ['Pool Swimming', 'swim'],
      ['Open Water Swimming', 'swim'],
      ['Strength Training', 'strength'],
      ['Functional Strength Training', 'strength'],
      ['Yoga', 'other'],
      ['Badminton', 'other'],
    ];
    for (const [name, group] of cases) expect([name, workoutGroup(name, false)]).toEqual([name, group]);
  });

  it('a strength-logger workout is strength whatever its watch sport name says', () => {
    expect(workoutGroup('Workout (type 9)', true)).toBe('strength');
    expect(workoutGroup('Running', true)).toBe('strength');
  });
});

describe('chips', () => {
  const names = ['Running', 'Running', 'Cycling', 'Yoga'];
  const counts = countGroups(names, (n) => workoutGroup(n, false));

  it('counts per group and hides chips without workouts, in chip order', () => {
    expect(counts).toEqual({ all: 4, run: 2, walk: 0, ride: 1, swim: 0, strength: 0, other: 1 });
    expect(visibleFilters(counts)).toEqual(['all', 'run', 'ride', 'other']);
  });

  it('a remembered filter that has no workouts left reads as all', () => {
    expect(effectiveFilter('ride', counts)).toBe('ride');
    expect(effectiveFilter('swim', counts)).toBe('all');
    expect(effectiveFilter('all', countGroups([], () => 'run'))).toBe('all');
  });
});

describe('parseView', () => {
  it('reads what was stored and falls back field by field', () => {
    expect(parseView('{"filter":"ride","period":"month"}')).toEqual({ filter: 'ride', period: 'month' });
    expect(parseView('{"filter":"golf","period":"year"}')).toEqual({ filter: 'all', period: 'week' });
    expect(parseView('not json')).toEqual({ filter: 'all', period: 'week' });
    expect(parseView(null)).toEqual({ filter: 'all', period: 'week' });
  });
});
