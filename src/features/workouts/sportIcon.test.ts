import { describe, expect, it } from 'bun:test';

import en from '@/i18n/locales/en/workouts.json';

import { sportIcon } from './sportIcon';

describe('sportIcon', () => {
  it('draws people for the sports done on foot, on wheels and in the water', () => {
    expect(sportIcon('Running')).toBe('run');
    expect(sportIcon('Run')).toBe('run');
    expect(sportIcon('Treadmill run')).toBe('run');
    expect(sportIcon('Trail run')).toBe('run');
    expect(sportIcon('Walking')).toBe('walk');
    expect(sportIcon('Indoor Walking')).toBe('walk');
    expect(sportIcon('Mountain Hike')).toBe('hiking');
    expect(sportIcon('Hike')).toBe('hiking');
    expect(sportIcon('Biking')).toBe('bike');
    expect(sportIcon('Indoor ride')).toBe('bike');
    expect(sportIcon('Spinning')).toBe('bike');
    expect(sportIcon('Pool Swimming')).toBe('swim');
    expect(sportIcon('Swimming (Open water)')).toBe('swim');
    expect(sportIcon('Free Diving')).toBe('diving-scuba');
  });

  it('tells the other sports apart', () => {
    expect(sportIcon('Jumping Rope')).toBe('jump-rope');
    expect(sportIcon('Rowing Machine')).toBe('rowing');
    expect(sportIcon('Rowing')).toBe('rowing');
    expect(sportIcon('Yoga')).toBe('yoga');
    expect(sportIcon('Tai chi')).toBe('meditation');
    expect(sportIcon('Boxing')).toBe('boxing-glove');
    expect(sportIcon('Body combat')).toBe('boxing-glove');
    expect(sportIcon('Karate')).toBe('karate');
    expect(sportIcon('Fencing')).toBe('fencing');
    expect(sportIcon('Latin dance')).toBe('dance-ballroom');
    expect(sportIcon('Strength Training')).toBe('weight-lifter');
    expect(sportIcon('Crossfit')).toBe('weight-lifter');
    expect(sportIcon('Horizontal bar')).toBe('gymnastics');
    expect(sportIcon('High-intensity Interval Training')).toBe('run-fast');
    expect(sportIcon('Soccer')).toBe('soccer');
    expect(sportIcon('Beach Volleyball')).toBe('volleyball');
    expect(sportIcon('Ping Pong')).toBe('table-tennis');
    expect(sportIcon('Tennis')).toBe('tennis');
    expect(sportIcon('Badminton')).toBe('badminton');
    expect(sportIcon('Stairs')).toBe('stairs');
    expect(sportIcon('Pool')).toBe('billiards');
  });

  it('reads FIT import names and falls back for a sport nobody drew', () => {
    expect(sportIcon('Run (Garmin)')).toBe('run');
    expect(sportIcon('Workout (type 9)')).toBe('heart-pulse');
    expect(sportIcon('')).toBe('heart-pulse');
    expect(sportIcon('Tug of war')).toBe('heart-pulse');
  });

  it('uses the sport kind when the name is in another language', () => {
    expect(sportIcon('Lari')).toBe('heart-pulse');
    expect(sportIcon('Lari', 'run')).toBe('run');
    expect(sportIcon('Bersepeda', 'ride')).toBe('bike');
    expect(sportIcon('Yoga', 'other')).toBe('yoga');
    expect(sportIcon('Mystery', 'other')).toBe('heart-pulse');
  });

  it('gives the sports the watch names a variety of glyphs, not one for all', () => {
    const glyphs = Object.values(en.sport).map((name) => sportIcon(name));
    expect(glyphs).toContain('run');
    expect(glyphs.filter((glyph) => glyph === 'heart-pulse').length).toBeLessThan(glyphs.length / 4);
  });
});
