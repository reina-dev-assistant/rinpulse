import { describe, expect, test } from 'bun:test';

import { getT } from '@/i18n';
import type { AnswerEvent } from '../answer';
import type { ChatMessage } from '../conversations';
import {
  assistantMessage,
  createCoalescer,
  displayTitle,
  distanceFromBottom,
  splitStable,
  nextAway,
  JUMP_ROOM_PX,
  roomShift,
  shiftOnGrowth,
  initialLive,
  isNearBottom,
  lastIndexOfRole,
  liveStatus,
  NEAR_BOTTOM_PX,
  parseSeed,
  partialOnStop,
  reduceLive,
  runningPhrase,
  seedText,
  stepCall,
  stepPhrase,
  stepResult,
  toSeconds,
  toStepRecords,
  type LiveState,
} from './chatState';

const tId = getT('id', 'ai');
const tEn = getT('en', 'ai');

const apply = (events: AnswerEvent[], from: LiveState = initialLive()): LiveState => events.reduce(reduceLive, from);

const SLEEP = { tool: 'get_daily', args: { from: '2026-10-01', to: '2026-10-14', fields: 'sleepMin,hrvMs' } } as const;
const DONE = { count: 14, empty: false, failed: false, notConnected: false };

describe('reduceLive', () => {
  test('text and reasoning deltas accumulate', () => {
    const s = apply([
      { type: 'round', round: 1 },
      { type: 'reasoning', delta: 'Cek ' },
      { type: 'reasoning', delta: 'tidur.' },
      { type: 'text', delta: 'Tidurmu ' },
      { type: 'text', delta: 'cukup.' },
    ]);
    expect(s.text).toBe('Tidurmu cukup.');
    expect(s.reasoning).toBe('Cek tidur.');
    expect(s.round).toBe(1);
  });

  test('a new round clears the preamble text but keeps steps and reasoning', () => {
    const s = apply([
      { type: 'round', round: 1 },
      { type: 'reasoning', delta: 'Perlu data.' },
      { type: 'text', delta: 'Aku cek dulu ya.' },
      { type: 'toolStart', id: 't1', trace: { tool: 'get_daily', args: {} } },
      { type: 'toolDone', id: 't1', trace: SLEEP, summary: DONE },
      { type: 'round', round: 2 },
    ]);
    expect(s.text).toBe('');
    expect(s.steps).toHaveLength(1);
    expect(s.reasoning).toBe('Perlu data.\n\n');
    expect(apply([{ type: 'reasoning', delta: 'Sudah.' }], s).reasoning).toBe('Perlu data.\n\nSudah.');
    expect(s.round).toBe(2);
  });

  test('a tool runs, then ends with its arguments and summary', () => {
    const started = apply([{ type: 'toolStart', id: 't1', trace: { tool: 'get_daily', args: {} } }]);
    expect(started.steps).toEqual([expect.objectContaining({ id: 't1', tool: 'get_daily', running: true, count: null })]);
    const ended = reduceLive(started, { type: 'toolDone', id: 't1', trace: SLEEP, summary: DONE });
    expect(ended.steps).toEqual([{ id: 't1', tool: 'get_daily', args: SLEEP.args, count: 14, empty: false, failed: false, notConnected: false, running: false }]);
  });

  test('a repeated start does not add a second step, and a done without a start still shows', () => {
    const s = apply([
      { type: 'toolStart', id: 't1', trace: { tool: 'get_plan', args: {} } },
      { type: 'toolStart', id: 't1', trace: { tool: 'get_plan', args: {} } },
      { type: 'toolDone', id: 't2', trace: { tool: 'get_plan', args: {} }, summary: { count: null, empty: true, failed: false, notConnected: false } },
    ]);
    expect(s.steps.map((x) => x.id)).toEqual(['t1', 't2']);
    expect(s.steps[1]!.empty).toBe(true);
  });

  test('reasoning is capped', () => {
    const s = apply([{ type: 'reasoning', delta: 'x'.repeat(10_000) }]);
    expect(s.reasoning.length).toBe(6_000);
  });

  test('the input state is not mutated', () => {
    const before = initialLive();
    reduceLive(before, { type: 'text', delta: 'a' });
    expect(before).toEqual(initialLive());
  });
});

describe('liveStatus', () => {
  test('a running tool wins, then reasoning without text, then writing', () => {
    const running = apply([{ type: 'toolStart', id: 't1', trace: { tool: 'get_plan', args: {} } }]);
    expect(liveStatus(running).kind).toBe('tool');
    expect(liveStatus(apply([{ type: 'reasoning', delta: 'hm' }])).kind).toBe('reasoning');
    expect(liveStatus(apply([{ type: 'reasoning', delta: 'hm' }, { type: 'text', delta: 'a' }])).kind).toBe('writing');
    expect(liveStatus(initialLive()).kind).toBe('writing');
  });
});

describe('stopping', () => {
  test('keeps the partial text with the steps that finished, marked stopped', () => {
    const s = apply([
      { type: 'toolStart', id: 't1', trace: SLEEP },
      { type: 'toolDone', id: 't1', trace: SLEEP, summary: DONE },
      { type: 'toolStart', id: 't2', trace: { tool: 'get_plan', args: {} } },
      { type: 'text', delta: '  Tidurmu kemarin ' },
    ]);
    const partial = partialOnStop(s);
    expect(partial).not.toBeNull();
    const message = assistantMessage({ id: 'm1', at: 5, engine: 'byok', model: 'm', ...partial! });
    expect(message.content).toBe('Tidurmu kemarin');
    expect(message.stopped).toBe(true);
    // The tool that never finished is not stored.
    expect(message.steps?.map((x) => x.id)).toEqual(['t1']);
  });

  test('drops everything when no text arrived', () => {
    expect(partialOnStop(apply([{ type: 'toolStart', id: 't1', trace: SLEEP }, { type: 'reasoning', delta: 'hm' }]))).toBeNull();
    expect(partialOnStop(apply([{ type: 'text', delta: '   ' }]))).toBeNull();
  });
});

describe('assistantMessage and steps', () => {
  test('converts answer steps to records and leaves empty fields out', () => {
    const steps = toStepRecords([{ id: 'a', trace: SLEEP, summary: { count: null, empty: false, failed: true, notConnected: false } }]);
    expect(steps).toEqual([{ id: 'a', tool: 'get_daily', args: SLEEP.args, count: null, empty: false, failed: true, notConnected: false }]);
    const message = assistantMessage({ id: 'm', at: 1, content: 'Halo', engine: 'rogo', steps: [], reasoning: '  ', proposed: [], tokens: { input: 0, output: 0 } });
    expect(message).toEqual({ id: 'm', role: 'assistant', content: 'Halo', at: 1, engine: 'rogo' });
  });

  test('keeps tokens, reasoning, proposals and the fixed flag when present', () => {
    const message = assistantMessage({
      id: 'm',
      at: 1,
      content: 'Halo',
      engine: 'byok',
      provider: 'openai',
      model: 'gpt-x',
      reasoning: ' pikir ',
      proposed: ['lutut kiri'],
      tokens: { input: 10, output: 5 },
      fixed: true,
    });
    expect(message).toMatchObject({ provider: 'openai', model: 'gpt-x', reasoning: 'pikir', proposed: ['lutut kiri'], tokens: { input: 10, output: 5 }, fixed: true });
  });
});

describe('createCoalescer', () => {
  function fakeClock() {
    let now = 1_000;
    let seq = 0;
    const timers = new Map<number, { at: number; run: () => void }>();
    return {
      clock: {
        now: () => now,
        setTimer: (run: () => void, ms: number) => {
          seq += 1;
          timers.set(seq, { at: now + ms, run });
          return seq;
        },
        clearTimer: (h: unknown) => void timers.delete(h as number),
      },
      advance(ms: number) {
        now += ms;
        for (const [id, timer] of [...timers]) {
          if (timer.at <= now) {
            timers.delete(id);
            timer.run();
          }
        }
      },
      pending: () => timers.size,
    };
  }

  test('the first change shows at once, then many schedules inside one interval commit once', () => {
    const f = fakeClock();
    let commits = 0;
    const c = createCoalescer(() => (commits += 1), 50, f.clock);
    c.schedule();
    f.advance(0);
    expect(commits).toBe(1);
    for (let i = 0; i < 100; i += 1) c.schedule();
    expect(f.pending()).toBe(1);
    f.advance(49);
    expect(commits).toBe(1);
    f.advance(1);
    expect(commits).toBe(2);
  });

  test('after a commit the next one waits out the rest of the interval', () => {
    const f = fakeClock();
    let commits = 0;
    const c = createCoalescer(() => (commits += 1), 50, f.clock);
    c.schedule();
    f.advance(0);
    expect(commits).toBe(1);
    f.advance(20);
    c.schedule();
    f.advance(29);
    expect(commits).toBe(1);
    f.advance(1);
    expect(commits).toBe(2);
  });

  test('flush commits now and clears the pending timer; cancel drops it', () => {
    const f = fakeClock();
    let commits = 0;
    const c = createCoalescer(() => (commits += 1), 50, f.clock);
    c.schedule();
    c.flush();
    expect(commits).toBe(1);
    expect(f.pending()).toBe(0);
    c.schedule();
    c.cancel();
    f.advance(500);
    expect(commits).toBe(1);
  });
});

describe('step words', () => {
  test('reads a day range with its fields', () => {
    expect(stepPhrase(SLEEP, tId)).toBe('Membaca tidur, HRV 14 hari');
    expect(runningPhrase(SLEEP, tId)).toBe('Membaca tidur, HRV 14 hari...');
    expect(stepPhrase({ tool: 'get_daily', args: { from: '2026-10-01', to: '2026-10-07' } }, tEn)).toBe('Reading daily data 7 days');
  });

  test('a step that just started has no arguments and is worded by its tool', () => {
    expect(runningPhrase({ tool: 'get_daily', args: {} }, tId)).toBe('Membaca data harian...');
    expect(stepPhrase({ tool: 'get_trend', args: {} }, tId)).toBe('Membaca tren');
    expect(stepPhrase({ tool: 'get_sleep_night', args: {} }, tId)).toBe('Membaca satu malam tidur');
  });

  test('every tool has a phrase in both languages', () => {
    const tools = ['get_daily', 'get_trend', 'get_sleep_night', 'list_workouts', 'get_workout', 'get_nutrition', 'get_plan', 'propose_note'] as const;
    for (const tool of tools) {
      expect(stepPhrase({ tool, args: {} }, tId).length).toBeGreaterThan(0);
      expect(stepPhrase({ tool, args: {} }, tEn).length).toBeGreaterThan(0);
    }
    expect(stepPhrase({ tool: 'get_trend', args: { metric: 'hrvMs', days: 30 } }, tEn)).toBe('Reading HRV trend 30 days');
    expect(stepPhrase({ tool: 'get_nutrition', args: { from: '2026-10-01', to: '2026-10-01' } }, tEn)).toBe('Reading food 1 day');
    expect(stepPhrase({ tool: 'get_sleep_night', args: { date: '2026-10-14' } }, tId)).toBe('Membaca tidur malam 2026-10-14');
  });

  test('results: rows, nothing, failed, sign-in', () => {
    expect(stepResult({ count: 14, empty: false, failed: false, notConnected: false }, tId)).toBe('14 baris');
    expect(stepResult({ count: 1, empty: false, failed: false, notConnected: false }, tEn)).toBe('1 row');
    expect(stepResult({ count: 0, empty: true, failed: false, notConnected: false }, tId)).toBe('tidak ada data');
    expect(stepResult({ count: null, empty: false, failed: true, notConnected: false }, tId)).toBe('gagal');
    expect(stepResult({ count: null, empty: false, failed: false, notConnected: true }, tId)).toBe('perlu masuk JoyoRogo');
    expect(stepResult({ count: null, empty: false, failed: false, notConnected: false }, tId)).toBe('selesai');
  });

  test('the exact call shows names, never values', () => {
    expect(stepCall(SLEEP)).toBe('get_daily(from=2026-10-01, to=2026-10-14, fields=sleepMin,hrvMs)');
    expect(stepCall({ tool: 'get_plan', args: {} })).toBe('get_plan()');
  });
});

describe('conversation helpers', () => {
  test('the title falls back while it is empty', () => {
    expect(displayTitle('', 'Percakapan baru')).toBe('Percakapan baru');
    expect(displayTitle('  ', 'Percakapan baru')).toBe('Percakapan baru');
    expect(displayTitle('Tidur', 'Percakapan baru')).toBe('Tidur');
  });

  test('milliseconds become the seconds of formatAgo', () => {
    expect(toSeconds(1_792_000_123_456)).toBe(1_792_000_123);
  });

  test('finds the last message of a role', () => {
    const m = (role: ChatMessage['role']): ChatMessage => ({ id: role, role, content: 'x', at: 0 });
    expect(lastIndexOfRole([m('user'), m('assistant'), m('user')], 'user')).toBe(2);
    expect(lastIndexOfRole([m('user'), m('assistant')], 'assistant')).toBe(1);
    expect(lastIndexOfRole([], 'user')).toBe(-1);
  });
});

describe('near the bottom', () => {
  const at = (offsetY: number) => ({ offsetY, viewportH: 600, contentH: 2_000 });

  test('distance from the end', () => {
    expect(distanceFromBottom(at(1_400))).toBe(0);
    expect(distanceFromBottom(at(1_000))).toBe(400);
    // Overscroll never reads as negative.
    expect(distanceFromBottom(at(1_500))).toBe(0);
  });

  test('the threshold is inclusive', () => {
    expect(isNearBottom(at(1_400 - NEAR_BOTTOM_PX))).toBe(true);
    expect(isNearBottom(at(1_400 - NEAR_BOTTOM_PX - 1))).toBe(false);
    expect(isNearBottom(at(1_000), 500)).toBe(true);
  });

  test('a chat shorter than the screen is at the bottom', () => {
    expect(isNearBottom({ offsetY: 0, viewportH: 600, contentH: 300 })).toBe(true);
  });
});

describe('seed', () => {
  test('a workout seed carries its ref and label', () => {
    const seed = parseSeed({ seed: 'workout', ref: 'w:1729500000', label: 'Lari pagi, 21 Okt' });
    expect(seed).toEqual({ kind: 'workout', ref: 'w:1729500000', label: 'Lari pagi, 21 Okt' });
    expect(seedText(seed!, tId)).toBe('Debrief latihan ini: Lari pagi, 21 Okt (id w:1729500000). Apa yang berjalan baik dan apa yang perlu diperhatikan?');
    expect(seedText(seed!, tEn)).toBe('Debrief this workout: Lari pagi, 21 Okt (id w:1729500000). What went well and what should I watch?');
  });

  test('a sleep seed needs a local date and falls back to it as the label', () => {
    const seed = parseSeed({ seed: 'sleep', ref: '2026-10-21' });
    expect(seed).toEqual({ kind: 'sleep', ref: '2026-10-21', label: '2026-10-21' });
    expect(seedText(seed!, tId)).toBe('Bagaimana tidurku semalam (2026-10-21, tanggal 2026-10-21)? Apa yang memengaruhinya?');
    expect(seedText(seed!, tEn)).toContain('date 2026-10-21');
  });

  test('missing or malformed params give no seed', () => {
    expect(parseSeed({})).toBeNull();
    expect(parseSeed({ seed: 'food', ref: 'x' })).toBeNull();
    expect(parseSeed({ seed: 'sleep', ref: 'kemarin' })).toBeNull();
    expect(parseSeed({ seed: 'workout', ref: '' })).toBeNull();
    expect(parseSeed({ seed: 'workout', ref: 'w:1 DROP' })).toBeNull();
  });

  test('the label is one short line and params may arrive as arrays', () => {
    const seed = parseSeed({ seed: ['workout'], ref: ['w:5'], label: ['  Lari\n pagi  '.padEnd(200, 'x')] });
    expect(seed?.label.includes('\n')).toBe(false);
    expect(seed?.label.length).toBe(80);
    expect(seed?.label.startsWith('Lari pagi')).toBe(true);
  });
});

describe('splitStable (the settled part of streaming text)', () => {
  test('splits at the last blank line; the tail is the paragraph still being written', () => {
    expect(splitStable('Satu.\n\nDua.\n\nTiga sedang')).toEqual({ head: 'Satu.\n\nDua.', tail: 'Tiga sedang' });
    expect(splitStable('Satu saja')).toEqual({ head: '', tail: 'Satu saja' });
    expect(splitStable('')).toEqual({ head: '', tail: '' });
    expect(splitStable('\n\nawal')).toEqual({ head: '', tail: '\n\nawal' });
  });
  test('a blank line inside an open code fence is not a split point', () => {
    expect(splitStable('Intro\n\n```\nkode\n\nlagi')).toEqual({ head: 'Intro', tail: '```\nkode\n\nlagi' });
    expect(splitStable('Intro\n\n```\nkode\n```\n\nSesudah')).toEqual({ head: 'Intro\n\n```\nkode\n```', tail: 'Sesudah' });
  });
  test('head and tail together always hold every character apart from the blank lines between them', () => {
    const text = '# Judul\n\n- a\n- b\n\n1. satu\n\n2. dua\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nAkhir';
    for (let n = 1; n <= text.length; n++) {
      const { head, tail } = splitStable(text.slice(0, n));
      expect((head + tail).replace(/\n/g, '')).toBe(text.slice(0, n).replace(/\n/g, ''));
    }
  });
  test('the split point only moves forward as text grows (so the settled part is never redrawn)', () => {
    const text = 'A.\n\nB.\n\nC.\n\nD sedang ditulis';
    let last = 0;
    for (let n = 1; n <= text.length; n++) {
      const { head } = splitStable(text.slice(0, n));
      expect(head.length).toBeGreaterThanOrEqual(last);
      last = head.length;
    }
  });
});

describe('away from the newest message', () => {
  test('hysteresis: away past 160 px, back only within 80 px', () => {
    expect(nextAway(false, 100)).toBe(false);
    expect(nextAway(false, 161)).toBe(true);
    expect(nextAway(true, 120)).toBe(true);
    expect(nextAway(true, 80)).toBe(false);
    expect(nextAway(true, 0)).toBe(false);
  });
  test('the list moves for growth only when the person reads older text and the newest message is what changed', () => {
    const base = { prev: 1000, next: 1400, offset: 600, away: true, windowOpen: true };
    expect(shiftOnGrowth(base)).toBe(400);
    expect(shiftOnGrowth({ ...base, away: false })).toBe(0);
    expect(shiftOnGrowth({ ...base, windowOpen: false })).toBe(0);
    expect(shiftOnGrowth({ ...base, offset: 0 })).toBe(0);
    expect(shiftOnGrowth({ ...base, next: 900 })).toBe(0);
    expect(shiftOnGrowth({ ...base, prev: 0 })).toBe(0);
  });
  test('the room under the newest message for the jump button is followed by the offset, in both directions', () => {
    expect(roomShift(JUMP_ROOM_PX)).toBe(JUMP_ROOM_PX);
    expect(roomShift(-JUMP_ROOM_PX)).toBe(-JUMP_ROOM_PX);
    expect(roomShift(400)).toBe(0);
    expect(roomShift(0)).toBe(0);
  });
});
