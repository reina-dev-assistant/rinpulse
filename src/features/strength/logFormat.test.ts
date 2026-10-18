import { describe, expect, it } from 'bun:test';

import { addExercises, emptyDraft } from './draft';
import {
  clampRestChoice,
  clampReps,
  clampWeight,
  defaultWorkoutName,
  inputText,
  parseNumber,
  parseSeconds,
  partOfDay,
  previousAt,
  previousLabel,
  prValueText,
  REST_CHOICES,
  restLabel,
  setExerciseRestOrOff,
  stepRest,
  supersetLetters,
  timerText,
} from './logFormat';

describe('number entry', () => {
  it('accepts comma and dot decimals', () => {
    expect(parseNumber('7,5')).toBe(7.5);
    expect(parseNumber('7.5')).toBe(7.5);
    expect(parseNumber(' 60 ')).toBe(60);
  });

  it('rejects empty, negative and garbage', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(',')).toBeNull();
    expect(parseNumber('-5')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  it('writes a value back with the separator of the language and no float noise', () => {
    expect(inputText(null)).toBe('');
    expect(inputText(62.5, ',')).toBe('62,5');
    expect(inputText(62.5, '.')).toBe('62.5');
    expect(inputText(0.1 + 0.2, '.')).toBe('0.3');
    expect(inputText(60, ',')).toBe('60');
  });

  it('clamps to sane ranges', () => {
    expect(clampWeight(5000)).toBe(1000);
    expect(clampWeight(22.256)).toBe(22.26);
    expect(clampReps(7.6)).toBe(8);
    expect(clampReps(100000)).toBe(999);
    expect(clampReps(null)).toBeNull();
  });
});

describe('parseSeconds', () => {
  it('reads plain seconds and m:ss', () => {
    expect(parseSeconds('90')).toBe(90);
    expect(parseSeconds('1:30')).toBe(90);
    expect(parseSeconds('2:')).toBe(120);
    expect(parseSeconds('1:2:3')).toBeNull();
    expect(parseSeconds('x:30')).toBeNull();
    expect(parseSeconds('')).toBeNull();
  });
});

describe('timerText', () => {
  it('shows m:ss and h:mm:ss', () => {
    expect(timerText(0)).toBe('0:00');
    expect(timerText(75)).toBe('1:15');
    expect(timerText(3600 + 125)).toBe('1:02:05');
    expect(timerText(-4)).toBe('0:00');
  });
});

describe('default name', () => {
  it('follows the part of the day', () => {
    expect(partOfDay(5)).toBe('morning');
    expect(partOfDay(11)).toBe('morning');
    expect(partOfDay(12)).toBe('afternoon');
    expect(partOfDay(16)).toBe('afternoon');
    expect(partOfDay(17)).toBe('evening');
    expect(partOfDay(20)).toBe('evening');
    expect(partOfDay(21)).toBe('night');
    expect(partOfDay(3)).toBe('night');
  });

  it('is written in the language', () => {
    expect(defaultWorkoutName(new Date(2026, 5, 1, 7, 0).getTime())).toBe('Latihan pagi');
  });
});

describe('previous column', () => {
  it('reads weight x reps, bare reps and time', () => {
    expect(previousLabel({ weightKg: 60, reps: 8, seconds: null }, false)).toBe('60 kg x 8');
    expect(previousLabel({ weightKg: null, reps: 12, seconds: null }, false)).toBe('12');
    expect(previousLabel({ weightKg: 0, reps: 12, seconds: null }, false)).toBe('12');
    expect(previousLabel({ weightKg: null, reps: null, seconds: 45 }, true)).toBe('0:45');
    expect(previousLabel({ weightKg: 62.5, reps: 5, seconds: null }, false)).toBe('62,5 kg x 5');
    expect(previousLabel({ weightKg: null, reps: null, seconds: null }, false)).toBeNull();
  });

  it('picks the set at the same position', () => {
    const prev = [
      { type: 'warmup', weightKg: 20, reps: 10, seconds: null },
      { type: 'normal', weightKg: 60, reps: 8, seconds: null },
    ];
    expect(previousAt(prev, 1)?.weightKg).toBe(60);
    expect(previousAt(prev, 2)).toBeNull();
    expect(previousAt(null, 0)).toBeNull();
  });
});

describe('supersets', () => {
  it('letters groups in order of appearance', () => {
    const letters = supersetLetters([{ supersetGroup: null }, { supersetGroup: 7 }, { supersetGroup: 7 }, { supersetGroup: 2 }]);
    expect(letters.get(7)).toBe('A');
    expect(letters.get(2)).toBe('B');
  });
});

describe('rest', () => {
  it('offers off first and sorted choices', () => {
    expect(REST_CHOICES[0]).toBe(0);
    expect([...REST_CHOICES]).toEqual([...REST_CHOICES].sort((a, b) => a - b));
    expect(restLabel(0)).toBe('Mati');
    expect(restLabel(45)).toBe('45 dtk');
    expect(restLabel(120)).toBe('2:00');
  });

  it('keeps off as 0 and clamps others', () => {
    const d = addExercises(emptyDraft(1), [{ exerciseId: 'squat', timed: false }]);
    const key = d.exercises[0]!.key;
    expect(setExerciseRestOrOff(d, key, 0).exercises[0]!.restSec).toBe(0);
    expect(setExerciseRestOrOff(d, key, 1).exercises[0]!.restSec).toBe(5);
    expect(setExerciseRestOrOff(d, key, null).exercises[0]!.restSec).toBeNull();
  });

  it('clamps a typed custom rest', () => {
    expect(clampRestChoice(75)).toBe(75);
    expect(clampRestChoice(2)).toBe(5);
    expect(clampRestChoice(5000)).toBe(900);
    expect(clampRestChoice(0)).toBeNull();
    expect(clampRestChoice(Number.NaN)).toBeNull();
  });

  it('steps the default by 15 seconds inside 30..300', () => {
    expect(stepRest(90, 1)).toBe(105);
    expect(stepRest(90, -1)).toBe(75);
    expect(stepRest(30, -1)).toBe(30);
    expect(stepRest(300, 1)).toBe(300);
  });
});

describe('record values', () => {
  it('formats by kind', () => {
    expect(prValueText('weight', 100)).toBe('100 kg');
    expect(prValueText('time', 90)).toBe('1:30');
    expect(prValueText('reps', 12)).toContain('12');
  });
});
