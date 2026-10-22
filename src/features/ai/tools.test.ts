import { describe, expect, test } from 'bun:test';

import { TOOL_LIMITS, TOOL_NAMES, TOOL_SPECS, runTool, summarize, trendOf, type ToolData } from './tools';
import { day, fakeToolData, TODAY } from './testFixtures';

const run = (name: string, args: Record<string, unknown>, data: ToolData = fakeToolData()) => runTool({ id: 't', name, args }, data);
const parse = (content: string) => JSON.parse(content) as Record<string, any>;

describe('tool definitions', () => {
  test('eight tools, all named, with object schemas', () => {
    expect(TOOL_SPECS.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).toHaveLength(8);
    for (const spec of TOOL_SPECS) expect(spec.parameters.type).toBe('object');
  });
  test('no tool writes: nothing in the data interface can change a record', () => {
    const fake = fakeToolData();
    expect(Object.keys(fake).filter((k) => /^(add|set|save|write|update|delete|remove|post|send|log)/i.test(k))).toEqual([]);
  });
});

describe('tool dispatch', () => {
  test('get_daily returns the asked fields for the range, null for unrecorded, and traces the call', async () => {
    const data = fakeToolData();
    const out = await run('get_daily', { from: '2026-10-20', to: '2026-10-22', fields: ['sleepMin', 'weightKg'] }, data);
    const body = parse(out.content);
    expect(body.rows).toEqual([
      { d: '2026-10-20', sleepMin: 420, weightKg: null },
      { d: '2026-10-21', sleepMin: 420, weightKg: null },
      { d: '2026-10-22', sleepMin: 420, weightKg: 81.5 },
    ]);
    expect(out.trace).toEqual({ tool: 'get_daily', args: { from: '2026-10-20', to: '2026-10-22', fields: 'sleepMin,weightKg' } });
    // food was not asked for, so JoyoRogo was not called for it
    expect(data.calls.some((c) => c.startsWith('food'))).toBe(false);
  });

  test('a range over 90 days is cut to the newest 90 and says so', async () => {
    const out = await run('get_daily', { from: '2026-01-01', to: TODAY, fields: ['steps'] });
    const body = parse(out.content);
    expect(body.rows.length).toBeLessThanOrEqual(TOOL_LIMITS.maxDays);
    expect(body.notes.join(' ')).toContain('range cut');
    expect(body.rows.at(-1).d).toBe(TODAY);
  });

  test('food fields only cover 14 days and say what is missing when signed out', async () => {
    const wide = parse((await run('get_daily', { from: '2026-09-01', to: TODAY, fields: ['eatKcal'] })).content);
    expect(wide.rows.filter((r: any) => r.eatKcal !== null).length).toBe(14);
    expect(wide.notes.join(' ')).toContain('only cover');
    const signedOut = fakeToolData({ food: async () => 'not_connected', weights: async () => 'not_connected' });
    const body = parse((await run('get_daily', { from: '2026-10-20', to: TODAY, fields: ['eatKcal', 'weightKg'] }, signedOut)).content);
    expect(body.rows.every((r: any) => r.eatKcal === null && r.weightKg === null)).toBe(true);
    expect(body.notes.join(' ')).toContain('not signed in');
  });

  test('get_trend is computed in code: mean, min, max, change against the previous period, sample count', async () => {
    const body = parse((await run('get_trend', { metric: 'hrvMs', days: 14 })).content);
    expect(body).toMatchObject({ metric: 'hrvMs', days: 14, mean: 40, min: 40, max: 40, n: 14, previous: { mean: 50, n: 14 }, deltaVsPrevious: -10 });
  });

  test('trendOf handles gaps, a single sample and no previous period', () => {
    expect(trendOf('steps', 7, [null, 10, 20, null], [30, null])).toMatchObject({ mean: 15, min: 10, max: 20, last: 20, n: 2, previous: { mean: 30, n: 1 }, deltaVsPrevious: -15 });
    expect(trendOf('steps', 7, [null, null], [1])).toMatchObject({ mean: null, n: 0, deltaVsPrevious: null });
    expect(trendOf('steps', 7, [5], [])).toMatchObject({ mean: 5, n: 1, previous: { mean: null, n: 0 }, deltaVsPrevious: null });
  });

  test('get_trend clamps days and limits food metrics to a 7 day window', async () => {
    expect(parse((await run('get_trend', { metric: 'steps', days: 400 })).content).days).toBe(90);
    expect(parse((await run('get_trend', { metric: 'steps', days: 1 })).content).days).toBe(7);
    expect(parse((await run('get_trend', { metric: 'eatKcal', days: 60 })).content).days).toBe(7);
  });

  test('get_sleep_night, get_plan, list_workouts, get_workout, get_nutrition read through the data source', async () => {
    const data = fakeToolData();
    expect(parse((await run('get_sleep_night', { date: TODAY }, data)).content)).toMatchObject({ onset: '23:10', stages: 'none' });
    expect(parse((await run('get_plan', {}, data)).content)).toMatchObject({ goal: 'run10k', week: 4 });
    expect(parse((await run('list_workouts', { from: '2026-10-01', to: TODAY, sport: 'run' }, data)).content).workouts).toHaveLength(1);
    expect(parse((await run('get_workout', { id: 'w:1' }, data)).content)).toMatchObject({ zoneMinutes: [3, 20, 15, 4, 0] });
    expect(parse((await run('get_workout', { id: 'w:nope' }, data)).content)).toEqual({ id: 'w:nope', found: false });
    const nutrition = parse((await run('get_nutrition', { from: '2026-10-20', to: TODAY }, data)).content);
    expect(nutrition.days).toHaveLength(3);
    expect(data.calls).toContain('workouts 2026-10-01 2026-10-22 run');
  });

  test('get_nutrition is not_connected when signed out and caps at 14 days', async () => {
    const signedOut = fakeToolData({ food: async () => 'not_connected' });
    expect(parse((await run('get_nutrition', { from: '2026-10-20', to: TODAY }, signedOut)).content)).toMatchObject({ not_connected: true });
    const body = parse((await run('get_nutrition', { from: '2026-06-01', to: TODAY })).content);
    expect(body.days).toHaveLength(14);
  });

  test('propose_note only proposes: the text comes back flattened and capped, nothing is stored by the tool', async () => {
    const data = fakeToolData();
    const out = await run('propose_note', { text: `Lutut kiri\nnyeri ${'x'.repeat(400)}` }, data);
    expect(out.proposedNote!.length).toBeLessThanOrEqual(200);
    expect(out.proposedNote).not.toContain('\n');
    expect(parse(out.content).status).toBe('proposed');
    expect(data.calls).toEqual([]);
  });

  test('bad arguments and unknown tools answer with an error object instead of throwing', async () => {
    expect(parse((await run('get_daily', { from: 'yesterday', to: TODAY })).content).error).toContain('YYYY-MM-DD');
    expect(parse((await run('get_daily', { from: '2026-02-31', to: TODAY })).content).error).toBeTruthy();
    expect(parse((await run('get_trend', { metric: 'cycleDay', days: 7 })).content).error).toContain('daily fields');
    expect(parse((await run('propose_note', { text: '   ' })).content).error).toBeTruthy();
    expect(parse((await run('delete_everything', {})).content).error).toContain('unknown tool');
  });

  test('a failing data source gives a generic error, never the raw exception', async () => {
    const broken = fakeToolData({ daily: async () => { throw new Error('SQLITE_CORRUPT at /data/user/0/app/db'); } });
    const out = await run('get_daily', { from: '2026-10-20', to: TODAY }, broken);
    expect(parse(out.content).error).toBe('the data could not be read');
    expect(out.content).not.toContain('SQLITE');
  });

  test('results are capped at 6,000 characters: old rows are dropped first', async () => {
    const big = fakeToolData({
      daily: async (from, to) => {
        const rows = [];
        for (let i = 0; i < 90; i++) rows.push(day(`2026-07-${String((i % 28) + 1).padStart(2, '0')}`, {}));
        return rows.map((r, i) => ({ ...r, d: `${from.slice(0, 5)}${String(i).padStart(3, '0')}-${to.length}` }));
      },
    });
    const out = await run('get_daily', { from: '2026-07-24', to: TODAY }, big);
    expect(out.content.length).toBeLessThanOrEqual(TOOL_LIMITS.resultChars);
    expect(parse(out.content).truncatedRows).toBeGreaterThan(0);
  });

  test('free text from the data source is flattened by the digest layer and workouts stay newest first when cut', async () => {
    const many = fakeToolData({
      workouts: async () => Array.from({ length: 40 }, (_, i) => ({ id: `w:${i}`, d: TODAY, sport: `Run ${i}`, min: 30, km: 5, avgBpm: 140, plan: null })),
    });
    const body = parse((await run('list_workouts', { from: '2026-09-01', to: TODAY }, many)).content);
    expect(body.workouts).toHaveLength(TOOL_LIMITS.workoutRows);
    expect(body.workouts[0].id).toBe('w:0');
  });
});

describe('tool step summaries (what the chat shows next to a step)', () => {
  test('rows found, nothing found, not connected, failed', async () => {
    expect((await run('get_daily', { from: '2026-10-20', to: TODAY })).summary).toEqual({ count: 3, empty: false, failed: false, notConnected: false });
    expect((await run('list_workouts', { from: '2026-10-01', to: TODAY }, fakeToolData({ workouts: async () => [] }))).summary).toMatchObject({ count: 0, empty: true });
    expect((await run('get_nutrition', { from: '2026-10-20', to: TODAY }, fakeToolData({ food: async () => 'not_connected' }))).summary).toMatchObject({ notConnected: true, empty: true });
    expect((await run('get_daily', { from: 'bad', to: TODAY })).summary).toMatchObject({ failed: true });
    expect((await run('get_workout', { id: 'w:nope' })).summary).toMatchObject({ empty: true, failed: false });
    expect((await run('get_trend', { metric: 'hrvMs', days: 14 })).summary).toMatchObject({ count: 14, empty: false });
    expect((await run('get_plan', {}, fakeToolData({ plan: async () => null }))).summary).toMatchObject({ empty: true });
  });
  test('summarize is total', () => {
    expect(summarize('not json')).toMatchObject({ failed: true });
    expect(summarize('5')).toMatchObject({ failed: true });
    expect(summarize('{}')).toMatchObject({ failed: false, count: null });
  });
});
