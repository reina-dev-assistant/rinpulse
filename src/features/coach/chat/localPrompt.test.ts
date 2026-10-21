import { describe, expect, test } from 'bun:test';

import type { CoachSnapshot } from '@/features/coach/chat/snapshot';

import { describeSnapshot, localMessages, localSystemPrompt } from './localPrompt';

/** A snapshot with everything set, so a test can blank one field and see what changes. */
function snapshot(overrides: Partial<CoachSnapshot> = {}): CoachSnapshot {
  return {
    generatedAt: 0,
    today: '2026-10-21',
    readiness: { headline: 'Balanced' },
    load: { status: 'productive', ratio: 1.1 },
    hrv: { state: 'balanced', recentMs: 48.2, baselineMs: 47.5 },
    sleep: { lastNightMin: 451, debtMin: 20, needTonightMin: 480 },
    strain: { yesterday: 12.5, today: 3.2, avg7: 10.1 },
    restingHr: 58,
    vo2max: 44,
    suggestion: { kind: 'easy', text: 'Easy 30 minutes', why: 'Load is high' },
    plan: {
      goal: '10K',
      level: 'intermediate',
      daysPerWeek: 3,
      week: 2,
      weeks: 8,
      doneThisWeek: 1,
      plannedThisWeek: 3,
      scalePct: 33,
      next: [{ date: '2026-10-22', title: 'Tempo 20 min' }],
    },
    workouts: [
      { start: 0, sport: 'run', durationMin: 32, distanceKm: 5.1, avgHr: 148, strain: 11.2, matchedPlan: true },
    ],
    ...overrides,
  };
}

describe('describeSnapshot', () => {
  test('writes the numbers the model needs, one per line', () => {
    const text = describeSnapshot(snapshot());
    expect(text).toContain('Readiness: Balanced');
    expect(text).toContain('Load: productive (ratio 1.10)');
    expect(text).toContain('HRV: balanced (recent 48 ms, baseline 48 ms)');
    expect(text).toContain('Resting heart rate: 58 bpm');
    expect(text).toContain('VO2max: 44');
    expect(text).toContain('Plan: goal 10K, level intermediate, 3 days a week, week 2 of 8');
    expect(text).toContain('Next sessions: 2026-10-22 Tempo 20 min');
    expect(text).toContain('run, 32 min, 5.10 km, 148 bpm, strain 11.2, planned');
  });

  test('leaves a missing field out instead of writing "null"', () => {
    // A model that reads "HRV: null" may invent a number; an absent line cannot be misread.
    const text = describeSnapshot(snapshot({ hrv: null, restingHr: null, vo2max: null, readiness: null, load: null }));
    expect(text).not.toContain('null');
    expect(text).not.toContain('HRV:');
    expect(text).not.toContain('Resting heart rate');
    expect(text).not.toContain('Readiness');
  });

  test('says so when no plan exists, rather than saying nothing', () => {
    // Silence invites the model to assume a plan; the line tells it to help set one up instead.
    const text = describeSnapshot(snapshot({ plan: null }));
    expect(text).toContain('Plan: none set up yet');
    expect(text).not.toContain('Plan: goal');
  });

  test('keeps only the sleep numbers that are known', () => {
    const text = describeSnapshot(snapshot({ sleep: { lastNightMin: 451, debtMin: null, needTonightMin: null } }));
    expect(text).toContain('Sleep: last night 451 min');
    expect(text).not.toContain('debt');
    expect(text).not.toContain('tonight');
  });

  test('omits the workout list entirely when there are none', () => {
    const text = describeSnapshot(snapshot({ workouts: [] }));
    expect(text).not.toContain('Recent workouts');
  });

  test('a workout with no distance or heart rate still lists what it has', () => {
    const text = describeSnapshot(
      snapshot({ workouts: [{ start: 0, sport: 'strength', durationMin: 40, distanceKm: null, avgHr: null, strain: null, matchedPlan: false }] }),
    );
    expect(text).toContain('strength, 40 min');
    expect(text).not.toContain('km');
    expect(text).not.toContain('planned');
  });
});

describe('localSystemPrompt', () => {
  test('carries the safety rules the server used to enforce', () => {
    // The server keyword-scanned for injuries and answered with a fixed reply. That is gone, so the
    // instruction has to be in the prompt; the UI says it is an instruction, not a guarantee.
    const prompt = localSystemPrompt(snapshot());
    expect(prompt).toContain('not a doctor');
    expect(prompt).toContain('see a doctor or physiotherapist');
    expect(prompt).toContain('do not give a training plan for it');
  });

  test('asks for short answers and forbids inventing data', () => {
    const prompt = localSystemPrompt(snapshot());
    expect(prompt).toContain('Be brief');
    expect(prompt).toContain('instead of inventing numbers');
    expect(prompt).toContain('Never promise weight loss');
  });

  test('states today, so the model can tell today from yesterday', () => {
    expect(localSystemPrompt(snapshot({ today: '2026-01-02' }))).toContain('Today is 2026-01-02');
  });

  test('carries the data through to the prompt', () => {
    // A prompt without the data would answer generically, which is the one thing the feature must not do.
    expect(localSystemPrompt(snapshot())).toContain('Resting heart rate: 58 bpm');
  });
});

describe('localMessages', () => {
  test('puts the system prompt first and the turns after it', () => {
    const messages = localMessages(snapshot(), [
      { role: 'user', content: 'Apa latihan hari ini?' },
      { role: 'assistant', content: 'Easy 30 menit.' },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'Apa latihan hari ini?' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Easy 30 menit.' });
  });

  test('a first message still carries the system prompt', () => {
    const messages = localMessages(snapshot(), [{ role: 'user', content: 'Halo' }]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
  });
});

describe('every section the snapshot carries reaches the prompt', () => {
  test('a fully populated snapshot shows every section', () => {
    // Guards against the prompt reading a field the snapshot stopped carrying: a section set but never
    // written is a silently smaller prompt, and the model would answer with less to go on.
    const text = describeSnapshot(snapshot());
    for (const section of ['Readiness:', 'Load:', 'HRV:', 'Sleep:', 'Strain:', 'Resting heart rate:', 'VO2max:', "Today's suggestion:", 'Plan:', 'Recent workouts']) {
      expect(text).toContain(section);
    }
  });

  test('blanking one section removes exactly that line', () => {
    // The other half: a section that is null must leave nothing behind, or the model reads a stale value.
    const full = describeSnapshot(snapshot());
    const withoutHrv = describeSnapshot(snapshot({ hrv: null }));
    expect(full).toContain('HRV:');
    expect(withoutHrv).not.toContain('HRV:');
    expect(withoutHrv).toContain('Resting heart rate:');
  });
});
