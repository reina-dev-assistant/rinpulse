import { afterEach, describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';
import type { Night, NightStage, StagePeriod } from '@/features/sleep/nights';
import { buildSleepSubject } from '@/features/stickers/data/sleep';

const H = 3600;
const START = 1_700_000_000;

function night(periods: [NightStage, number][], extra: Partial<Night> = {}): Night {
  let cursor = START;
  const list: StagePeriod[] = periods.map(([stage, sec]) => {
    const p = { start: cursor, end: cursor + sec, stage };
    cursor += sec;
    return p;
  });
  const seconds = { awake: 0, rem: 0, light: 0, deep: 0, asleep: 0 } as Record<NightStage, number>;
  for (const p of list) seconds[p.stage] += p.end - p.start;
  const asleepSeconds = seconds.rem + seconds.light + seconds.deep + seconds.asleep;
  return {
    start: START,
    end: cursor,
    day: '2023-11-15',
    periods: list,
    seconds,
    asleepSeconds,
    nap: asleepSeconds < 3 * H,
    awakenings: list.filter((p, i) => p.stage === 'awake' && i > 0 && i < list.length - 1).length,
    score: null,
    ...extra,
  };
}

const staged = () =>
  night([
    ['light', 2 * H],
    ['deep', 1.5 * H],
    ['awake', 0.5 * H],
    ['rem', 1.5 * H],
    ['light', 2.5 * H],
  ]);

const sleepOf = (n: Night, recent: number[] = [], locale: 'id' | 'en' = 'id') => buildSleepSubject({ night: n, recentAsleepSec: recent }, locale).data.sleep as Record<string, any>;

afterEach(() => applyLocale('id'));

describe('buildSleepSubject', () => {
  test('staged night with watch score', () => {
    const n = staged();
    n.score = { start: n.start, end: n.end, score: 84.4, efficiency: 90 };
    const subject = buildSleepSubject({ night: n, recentAsleepSec: [] }, 'id');
    const s = subject.data.sleep as Record<string, any>;
    expect(subject.id).toBe('sleep:2023-11-15');
    expect(subject.kinds).toEqual(['sleep']);
    expect(subject.date).toBe(n.end * 1000);
    expect(subject.caption).toBe('Dicatat dengan JoyoFit · https://fit.joyorogo.com');
    expect(subject.heading).toBe('Bagikan tidur');
    expect(s.score).toBe(84);
    expect(s.asleepSec).toBe(7.5 * H);
    expect(s.deepSec).toBe(1.5 * H);
    expect(s.remSec).toBe(1.5 * H);
    expect(s.lightSec).toBe(4.5 * H);
    expect(s.awakeSec).toBe(0.5 * H);
    expect(s.deepPct + s.remPct + s.lightPct + s.awakePct).toBeCloseTo(1, 10);
    expect(s.inBedSec).toBe(8 * H);
    expect(s.bedtime).toBe(START * 1000);
    expect(s.wakeTime).toBe(n.end * 1000);
    expect(s.awakenings).toBe(1);
    expect(s.verdict).toBe('Cukup');
    expect(s.nap).toBeUndefined();
    expect(s.vsAvgSec).toBeUndefined();
    expect(s.hypno).toHaveLength(48);
    expect(s.hypnoColors).toHaveLength(48);
    // 8 h in 48 buckets = 10 min each: first bucket light, bucket at 2h10 deep, 3h40 awake, 4h30 rem
    expect(s.hypno[0]).toBe(3);
    expect(s.hypno[13]).toBe(4);
    expect(s.hypno[21]).toBe(1);
    expect(s.hypno[27]).toBe(2);
    expect(s.hypno[47]).toBe(3);
    expect(s.hypnoColors[13]).toBe('#4B57B5');
    expect(s.hypnoColors[21]).toBe('#F0A23C');
    expect(s.hypnoColors[27]).toBe('#C09CF5');
    expect(s.hypnoColors[0]).toBe('#8F9BE3');
    expect(JSON.parse(JSON.stringify(subject))).toEqual(subject);
  });

  test('night without a score has no sleep.score key', () => {
    expect('score' in sleepOf(staged())).toBe(false);
  });

  test('unstaged night: no stage fields, no hypno, verdict from duration', () => {
    const n = night([['asleep', 7 * H]]);
    const s = sleepOf(n);
    for (const key of ['deepSec', 'remSec', 'lightSec', 'awakeSec', 'deepPct', 'remPct', 'lightPct', 'awakePct', 'hypno', 'hypnoColors', 'awakenings']) {
      expect(key in s).toBe(false);
    }
    expect(s.asleepSec).toBe(7 * H);
    expect(s.inBedSec).toBe(7 * H);
    expect(s.verdict).toBe('Cukup');
  });

  test('nap: nap flag, no verdict', () => {
    const s = sleepOf(night([['asleep', 1.5 * H]]));
    expect(s.nap).toBe(true);
    expect('verdict' in s).toBe(false);
    expect(s.asleepSec).toBe(1.5 * H);
  });

  test('verdict bands', () => {
    expect(sleepOf(night([['asleep', 5 * H]])).verdict).toBe('Kurang tidur');
    expect(sleepOf(night([['asleep', 6.5 * H]])).verdict).toBe('Lumayan');
    expect(sleepOf(night([['asleep', 9 * H]])).verdict).toBe('Cukup');
    expect(sleepOf(night([['asleep', 9.5 * H]])).verdict).toBe('Panjang');
  });

  test('vsAvgSec needs 3 nights of history', () => {
    const n = staged();
    expect(sleepOf(n, [6 * H, 7 * H, 8 * H, 9 * H]).vsAvgSec).toBe(0);
    expect(sleepOf(n, [6 * H, 6 * H, 6 * H]).vsAvgSec).toBe(1.5 * H);
    expect('vsAvgSec' in sleepOf(n, [6 * H, 6 * H])).toBe(false);
    // non-finite and zero entries do not count as nights
    expect('vsAvgSec' in sleepOf(n, [6 * H, NaN, Infinity, 0])).toBe(false);
    const seven = Array.from({ length: 7 }, () => 7 * H);
    expect(sleepOf(n, seven).vsAvgSec).toBe(0.5 * H);
  });

  test('stage with gap and unstaged span inside a staged night', () => {
    const n = staged();
    n.periods = [
      { start: START, end: START + 4 * H, stage: 'asleep' },
      { start: START + 6 * H, end: START + 8 * H, stage: 'deep' },
    ];
    const s = sleepOf(n);
    expect(s.hypno[0]).toBe(3);
    expect(s.hypno[30]).toBe(1); // 5 h: no record, shown as awake
    expect(s.hypno[47]).toBe(4);
  });

  test('NaN and Infinity guards', () => {
    const n = staged();
    n.score = { start: 0, end: 1, score: NaN, efficiency: null };
    n.awakenings = NaN;
    const s = sleepOf(n, [NaN, Infinity, -Infinity]);
    expect('score' in s).toBe(false);
    expect('awakenings' in s).toBe(false);
    expect('vsAvgSec' in s).toBe(false);

    const broken = staged();
    broken.start = NaN;
    broken.asleepSeconds = Infinity;
    broken.seconds = { awake: NaN, rem: 0, light: 0, deep: 0, asleep: 0 };
    const b = sleepOf(broken);
    for (const key of ['bedtime', 'inBedSec', 'asleepSec', 'hypno', 'deepSec', 'verdict', 'vsAvgSec']) expect(key in b).toBe(false);
    for (const value of Object.values(b)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });

  test('english texts', async () => {
    await applyLocale('en');
    const subject = buildSleepSubject({ night: staged(), recentAsleepSec: [] }, 'en');
    expect(subject.heading).toBe('Share sleep');
    expect(subject.caption).toBe('Tracked with JoyoFit · https://fit.joyorogo.com');
    expect((subject.data.sleep as Record<string, any>).verdict).toBe('Well rested');
    expect(sleepOf(night([['asleep', 5 * H]]), [], 'en').verdict).toBe('Short night');
  });
});
