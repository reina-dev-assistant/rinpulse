import { describe, expect, test } from 'bun:test';

import { buildPlan, defaultWeekdays, type PlanChoice } from './actions';
import type { CoachDoc, CoachPlan, DoneEntry, PlanLevel, RunGoal } from './doc';
import { EMPTY_COACH_DOC } from './doc';
import { sessionFeedback } from './feedback';
import { matchWorkouts, type MatchWorkout } from './match';
import { mergeCoachDocs, sameCoachDoc } from './merge';
import { adaptWeek, decideWeeks, NO_SIGNALS } from './plans/adapt';
import { allSessions, generatePlan, weekIndexAt } from './plans/generate';
import { RECIPES } from './plans/run';
import { planProgress, sessionStatus } from './progress';
import { suggest, type SuggestionInput } from './suggest';
import { newestCoachChange, syncCoachDoc, type CoachSyncIo, type PutResult, type RemoteCoach } from './syncDoc';
import { addDays, dayStartSec, localDay, mondayOf, weekdayOf } from './time';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';

// 2026-10-12 is a Monday. All the times below are local, like the app.
const MONDAY = '2026-10-12';
const noon = (day: string): number => dayStartSec(day) + 12 * 3600;

function choice(goal: RunGoal, level: PlanLevel, days: number): PlanChoice {
  return { kind: 'run', goal, level, daysPerWeek: days, setting: null, weekdays: defaultWeekdays(days) };
}

/** A plan that "was made" on its first Monday morning, so no session is before the start. */
function planOf(goal: RunGoal, level: PlanLevel, days: number): CoachPlan {
  return buildPlan(choice(goal, level, days), dayStartSec(MONDAY) * 1000 + 6 * 3600_000);
}

describe('time', () => {
  test('calendar arithmetic ignores clock changes', () => {
    expect(weekdayOf(MONDAY)).toBe(0);
    expect(weekdayOf('2026-10-18')).toBe(6);
    expect(mondayOf('2026-10-18')).toBe(MONDAY);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(localDay(noon(MONDAY))).toBe(MONDAY);
  });
});

describe('run plans', () => {
  test('every goal, level and weekly count builds weeks of sessions on the chosen weekdays', () => {
    for (const goal of Object.keys(RECIPES) as PlanGoal[]) {
      for (const level of ['beginner', 'intermediate', 'advanced'] as PlanLevel[]) {
        for (const days of goal === 'runRoutine' ? [3] : [3, 4, 5]) {
          const plan = planOf(goal, level, days);
          const weeks = generatePlan(plan);
          expect(weeks.length).toBe(plan.weeks);
          for (const week of weeks) {
            expect(week.sessions.length).toBe(days);
            for (const s of week.sessions) {
              expect(s.minutes).toBeGreaterThanOrEqual(10);
              expect(s.minutes).toBeLessThanOrEqual(190);
              expect(weekdayOf(s.day)).toBe(s.weekday);
            }
          }
        }
      }
    }
  });

  test('a beginner 5K starts with walk/run and ends with the distance itself', () => {
    const weeks = generatePlan(planOf('run5k', 'beginner', 3));
    expect(weeks.length).toBe(8);
    expect(weeks[0]!.sessions[0]!.type).toBe('walkrun');
    expect(weeks[0]!.sessions[0]!.run!.walkRun!.runSec).toBe(60);
    const last = weeks[7]!.sessions[2]!;
    expect(last.type).toBe('race');
    expect(last.run!.distanceM).toBe(5000);
    expect(weeks[7]!.phase).toBe('taper');
    expect(weeks[3]!.phase).toBe('cutback');
  });

  test('the same parameters give the same sessions', () => {
    const plan = planOf('run10k', 'intermediate', 4);
    expect(generatePlan(plan)).toEqual(generatePlan({ ...plan }));
  });

  test('volume builds and a cut-back week is lighter', () => {
    const weeks = generatePlan(planOf('runHalf', 'intermediate', 3));
    const longOf = (w: number) => weeks[w]!.sessions[2]!.minutes;
    expect(longOf(2)).toBeGreaterThan(longOf(0));
    expect(longOf(3)).toBeLessThan(longOf(2));
    expect(longOf(10)).toBeGreaterThan(longOf(5));
  });

  test('quality alternates tempo and intervals; beginners have none', () => {
    const inter = generatePlan(planOf('run10k', 'intermediate', 3));
    expect(inter[0]!.sessions[1]!.type).toBe('tempo');
    expect(inter[1]!.sessions[1]!.type).toBe('intervals');
    expect(inter[1]!.sessions[1]!.run!.intervals!.reps).toBeGreaterThanOrEqual(3);
    const beginner = generatePlan(planOf('run10k', 'beginner', 3));
    for (const week of beginner) {
      for (const s of week.sessions.slice(0, 2)) expect(['easy', 'walkrun']).toContain(s.type);
    }
  });

  test('weekly scale shrinks the sessions of that week only', () => {
    const plan = planOf('run10k', 'intermediate', 3);
    const base = generatePlan(plan);
    const scaled = generatePlan({ ...plan, adjust: { '2': { scalePct: 75, reason: 'overreaching', at: 0 } } });
    expect(scaled[2]!.sessions[0]!.minutes).toBeLessThan(base[2]!.sessions[0]!.minutes);
    expect(scaled[2]!.sessions[0]!.scalePct).toBe(75);
    expect(scaled[1]).toEqual(base[1]);
  });

  test('sessions before the day the plan was made do not count', () => {
    const wednesday = buildPlan(choice('run5k', 'beginner', 3), noon(addDays(MONDAY, 2)) * 1000);
    const first = generatePlan(wednesday)[0]!.sessions;
    expect(first[0]!.beforeStart).toBe(true); // Tuesday
    expect(first[1]!.beforeStart).toBe(false); // Thursday
    expect(weekIndexAt(wednesday, addDays(MONDAY, 9))).toBe(1);
  });
});

const BASE_INPUT: SuggestionInput = {
  readiness: 'Balanced',
  feel: null,
  load: { status: 'maintaining', ratio: 1 },
  hrv: 'balanced',
  lastNightMin: 450,
  sleepDebtMin: 30,
  strainYesterday: 6,
  strainDayBefore: 5,
  activeStreak: 0,
  recoveryHoursLeft: 0,
  trainedToday: null,
  usualSport: 'run',
  planned: null,
  plannedDone: false,
  missed: null,
  planState: 'none',
};

describe('daily suggestion', () => {
  test('a fresh body with no plan gets an easy run in zone 2', () => {
    const s = suggest(BASE_INPUT);
    expect(s.band).toBe('fresh');
    expect(s.kind).toBe('free');
    expect(s.effective).toEqual({ type: 'easy', minutes: 40, zone: 2 });
  });

  test('exhaustion means rest', () => {
    const s = suggest({ ...BASE_INPUT, readiness: 'Run down', hrv: 'low', lastNightMin: 300 });
    expect(s.band).toBe('exhausted');
    expect(s.kind).toBe('rest');
    expect(s.reasons.map((r) => r.code)).toContain('hrvLow');
  });

  test('tired without a plan is active rest', () => {
    const s = suggest({ ...BASE_INPUT, readiness: 'Strained', sleepDebtMin: 200 });
    expect(s.band).toBe('tired');
    expect(s.kind).toBe('activeRest');
    expect(s.effective!.type).toBe('walk');
  });

  const session = generatePlan(planOf('run10k', 'intermediate', 3))[0]!.sessions[1]!; // tempo

  test('the plan stands when fresh, is scaled when fair, and a hard session turns easy when tired', () => {
    const fresh = suggest({ ...BASE_INPUT, planState: 'active', planned: session });
    expect(fresh.kind).toBe('session');
    expect(fresh.effective!.type).toBe('tempo');

    const fair = suggest({ ...BASE_INPUT, planState: 'active', planned: session, lastNightMin: 400, sleepDebtMin: 100 });
    expect(fair.band).toBe('ok');
    expect(fair.kind).toBe('sessionScaled');
    expect(fair.scalePct).toBe(85);

    const tired = suggest({ ...BASE_INPUT, planState: 'active', planned: session, readiness: 'Strained', hrv: 'low' });
    expect(tired.band).toBe('tired');
    expect(tired.kind).toBe('sessionEasier');
    expect(tired.effective!.type).toBe('easy');
    expect(tired.effective!.minutes).toBeLessThanOrEqual(40);
  });

  test('a hard session is never put the day after a hard day', () => {
    const s = suggest({ ...BASE_INPUT, planState: 'active', planned: session, strainYesterday: 15 });
    expect(s.kind).toBe('sessionEasier');
    expect(s.reasons.map((r) => r.code)).toContain('afterHardDay');
  });

  test('already trained, plan done, rest day and a catch-up', () => {
    expect(suggest({ ...BASE_INPUT, trainedToday: { strain: 9 } }).kind).toBe('trainedToday');
    expect(suggest({ ...BASE_INPUT, planState: 'active', plannedDone: true }).kind).toBe('planDone');
    expect(suggest({ ...BASE_INPUT, planState: 'active' }).kind).toBe('planRestDay');
    expect(suggest({ ...BASE_INPUT, planState: 'active', missed: session }).kind).toBe('catchUp');
    expect(suggest({ ...BASE_INPUT, planState: 'active', missed: session, strainYesterday: 15 }).kind).toBe('planRestDay');
    expect(suggest({ ...BASE_INPUT, planState: 'finished' }).kind).toBe('planFinished');
  });

  test('with no signal at all it says it is general advice', () => {
    const s = suggest({
      ...BASE_INPUT,
      readiness: null,
      load: null,
      hrv: null,
      lastNightMin: null,
      sleepDebtMin: null,
      strainYesterday: null,
      strainDayBefore: null,
      recoveryHoursLeft: null,
      usualSport: null,
    });
    expect(s.reasons.map((r) => r.code)).toEqual(['noSignal']);
  });
});

describe('how you feel, without a watch reading', () => {
  const NO_WATCH = { ...BASE_INPUT, readiness: null, load: null, hrv: null, lastNightMin: null, sleepDebtMin: null, strainYesterday: null, strainDayBefore: null, recoveryHoursLeft: null };

  const plannedRun = generatePlan(planOf('run10k', 'intermediate', 3))[0]!.sessions[1]!;

  test('a tired answer scales the plan like a low readiness would', () => {
    const s = suggest({ ...NO_WATCH, feel: 'tired', planState: 'active', planned: plannedRun });
    expect(s.reasons.map((r) => r.code)).toContain('feelTired');
    expect(s.band).toBe('ok');
  });

  test('wrecked turns a hard run into an easy one', () => {
    const s = suggest({ ...NO_WATCH, feel: 'wrecked', planState: 'active', planned: plannedRun });
    expect(s.band).toBe('tired');
    expect(s.kind).toBe('sessionEasier');
  });

  test('great is a small credit and never blocks a session', () => {
    const s = suggest({ ...NO_WATCH, feel: 'great', planState: 'active', planned: plannedRun });
    expect(s.kind).toBe('session');
  });

  test('the watch readiness wins over the answer', () => {
    const s = suggest({ ...NO_WATCH, readiness: 'Primed', feel: 'wrecked' });
    expect(s.reasons.map((r) => r.code)).not.toContain('feelWrecked');
  });

  test('a lifter with no data at all gets a strength suggestion, not a run', () => {
    const s = suggest({ ...NO_WATCH, usualSport: 'strength' });
    expect(s.effective?.type).toBe('strength');
    expect(s.reasons.map((r) => r.code)).toEqual(['noSignal']);
  });
});

describe('weekly adaptation', () => {
  test('rules apply in order', () => {
    const none = { ...NO_SIGNALS };
    expect(adaptWeek({ planned: 3, done: 3 }, 100, { ...none, load: { status: 'overreaching', ratio: 1.7 } })).toEqual({ scalePct: 75, reason: 'overreaching' });
    expect(adaptWeek({ planned: 3, done: 1 }, 100, none)).toEqual({ scalePct: 80, reason: 'missed' });
    expect(adaptWeek({ planned: 3, done: 3 }, 100, { ...none, hrv: 'low' })).toEqual({ scalePct: 85, reason: 'low_recovery' });
    expect(adaptWeek({ planned: 3, done: 3 }, 80, { ...none, load: { status: 'productive', ratio: 1.2 } })).toEqual({ scalePct: 90, reason: 'strong' });
    expect(adaptWeek({ planned: 3, done: 2 }, 80, none)).toEqual({ scalePct: 90, reason: 'steady' });
  });

  test('weeks that passed are decided from completion alone, the current one reads the body', () => {
    const plan = planOf('run5k', 'intermediate', 3);
    const today = addDays(MONDAY, 15); // week index 2
    const done: Record<string, DoneEntry> = {};
    const adjust = decideWeeks(plan, done, today, { ...NO_SIGNALS, hrv: 'low' }, 1)!;
    expect(adjust['1']!.reason).toBe('missed'); // nothing done in week 0
    expect(adjust['2']!.reason).toBe('missed'); // week 1 empty: completion beats recovery
    expect(adjust['0']).toBeUndefined();
    expect(decideWeeks({ ...plan, adjust }, done, today, NO_SIGNALS, 2)).toBeNull();
    expect(decideWeeks(plan, done, MONDAY, NO_SIGNALS, 1)).toBeNull();
  });
});

function run(day: string, minutes: number, extra: Partial<MatchWorkout> = {}): MatchWorkout {
  return { start: noon(day), duration: minutes * 60, distance: minutes * 160, sportName: 'Running', summaryKind: 'RUNNING', ...extra };
}

describe('matching workouts to sessions', () => {
  const plan = planOf('run10k', 'intermediate', 3);
  const sessions = allSessions(generatePlan(plan));
  const tuesday = sessions[0]!;

  test('a long enough run on the day takes the session', () => {
    const added = matchWorkouts(sessions, {}, [run(tuesday.day, tuesday.minutes)], 5);
    expect(added[tuesday.key]).toEqual({ workoutStart: noon(tuesday.day), at: 5, manual: false, skipped: false });
  });

  test('too short, wrong sport or too far away does not match', () => {
    expect(matchWorkouts(sessions, {}, [run(tuesday.day, 5)], 5)).toEqual({});
    expect(matchWorkouts(sessions, {}, [run(tuesday.day, 60, { sportName: 'Cycling', summaryKind: 'CYCLING' })], 5)).toEqual({});
    expect(matchWorkouts(sessions, {}, [run(addDays(tuesday.day, -5), 60)], 5)).toEqual({});
  });

  test('a day early or two days late still counts; one workout is used once', () => {
    const early = matchWorkouts(sessions, {}, [run(addDays(tuesday.day, -1), tuesday.minutes)], 5);
    expect(Object.keys(early)).toEqual([tuesday.key]);
    const twice = matchWorkouts(sessions, {}, [run(tuesday.day, 90), run(tuesday.day, 90)], 5);
    expect(Object.keys(twice).length).toBe(1);
    const taken = matchWorkouts(sessions, { [tuesday.key]: { workoutStart: noon(tuesday.day), at: 1, manual: false, skipped: false } }, [run(tuesday.day, 90)], 5);
    expect(taken[tuesday.key]).toBeUndefined();
  });

  test('a taken-back mark frees the session but not the workout', () => {
    const cleared = { [tuesday.key]: { workoutStart: noon(tuesday.day), at: 1, manual: false, skipped: false, cleared: true } };
    expect(matchWorkouts(sessions, cleared, [run(tuesday.day, 90)], 5)).toEqual({});
  });

  test('a strength-type workout matches strength sessions only', () => {
    const strength = { ...sessions[0]!, kind: 'strength' as const, type: 'strength' as const };
    const workout = { start: noon(strength.day), duration: 45 * 60, distance: 0, sportName: 'Strength Training', summaryKind: 'STRENGTH_TRAINING' };
    expect(Object.keys(matchWorkouts([strength], {}, [workout], 5))).toEqual([strength.key]);
    expect(matchWorkouts(sessions, {}, [workout], 5)).toEqual({});
  });
});

describe('progress', () => {
  const plan = planOf('run5k', 'beginner', 3);
  test('counts this week, finds the missed session and the status of each', () => {
    const wednesday = addDays(MONDAY, 2);
    const done: Record<string, DoneEntry> = {};
    const p = planProgress(plan, done, wednesday);
    expect(p.state).toBe('active');
    expect(p.weekIndex).toBe(0);
    expect(p.plannedThisWeek).toBe(3);
    expect(p.missed?.weekday).toBe(1); // Tuesday
    const tuesday = p.weeks[0]!.sessions[0]!;
    expect(sessionStatus(tuesday, done, wednesday)).toBe('missed');
    const marked = { [tuesday.key]: { workoutStart: null, at: 1, manual: true, skipped: false } };
    expect(planProgress(plan, marked, wednesday).missed).toBeNull();
    expect(sessionStatus(tuesday, marked, wednesday)).toBe('done');
    expect(planProgress(plan, marked, wednesday).doneThisWeek).toBe(1);
    expect(planProgress(plan, done, addDays(MONDAY, 70)).state).toBe('finished');
    expect(planProgress(plan, done, addDays(MONDAY, -3)).state).toBe('upcoming');
  });
});

function analysisOf(zoneSec: number[], over: Partial<WorkoutAnalysis> = {}): WorkoutAnalysis {
  const total = zoneSec.reduce((a, b) => a + b, 0);
  return {
    v: 1,
    sport: { name: 'Running', kind: 'run' },
    startedAt: 0,
    elapsedSec: total,
    movingSec: total,
    distanceM: 5000,
    elevation: null,
    series: null,
    splits: [],
    laps: [],
    hrZones: { maxHr: 190, source: 'age', bounds: [95, 114, 133, 152, 171, 190], sec: zoneSec, belowSec: 0 },
    paceZones: { thresholdSecKm: 300, zones: [] },
    bestEfforts: [],
    effort: null,
    load: null,
    calories: null,
    comparison: null,
    stats: { avgHr: null, maxHr: null, minHr: null, avgPaceSecKm: 400, bestPaceSecKm: null, avgSpeedMs: null, maxSpeedMs: null, avgCad: null, maxCad: null, avgPower: null, maxPower: null, normalizedPower: null, avgStrideM: null },
    ...over,
  } as WorkoutAnalysis;
}

describe('post-workout feedback', () => {
  const plan = planOf('run10k', 'intermediate', 3);
  const weeks = generatePlan(plan);
  const easy = weeks[0]!.sessions[0]!; // easy run
  const tempo = weeks[0]!.sessions[1]!;

  test('an easy run kept in zone 1-2 at a fitting pace is on target', () => {
    const minutes = easy.minutes;
    // threshold 300 s/km: easy band 342 to 387 s/km
    const a = analysisOf([minutes * 30, minutes * 30, 0, 0, 0], { stats: { ...analysisOf([1]).stats, avgPaceSecKm: 360 } });
    const f = sessionFeedback(easy, a)!;
    expect(f.overall).toBe('onTarget');
    expect(f.lines.map((l) => l.key)).toEqual(['duration', 'zone', 'pace']);
  });

  test('an easy run run too hard is flagged by zone and pace', () => {
    const minutes = easy.minutes;
    const a = analysisOf([0, minutes * 10, minutes * 20, minutes * 20, minutes * 10], { stats: { ...analysisOf([1]).stats, avgPaceSecKm: 300 } });
    const f = sessionFeedback(easy, a)!;
    expect(f.overall).toBe('tooHard');
    expect(f.lines.find((l) => l.key === 'zone')!.verdict).toBe('over');
    expect(f.lines.find((l) => l.key === 'pace')!.verdict).toBe('over');
  });

  test('a short run, a tempo that was too gentle, and no run target for strength', () => {
    const short = sessionFeedback(easy, analysisOf([300, 300, 0, 0, 0]))!;
    expect(short.overall).toBe('short');
    const gentle = sessionFeedback(tempo, analysisOf([tempo.minutes * 40, tempo.minutes * 20, 0, 0, 0]))!;
    expect(gentle.lines.find((l) => l.key === 'zone')!.verdict).toBe('under');
    expect(gentle.overall).toBe('tooEasy');
    expect(sessionFeedback({ ...easy, kind: 'strength', run: null }, analysisOf([1]))).toBeNull();
  });

  test('the race checks the distance', () => {
    const race = generatePlan(planOf('run5k', 'intermediate', 3))[7]!.sessions[2]!;
    const f = sessionFeedback(race, analysisOf([0, 600, 900, 300, 0], { distanceM: 4800, elapsedSec: race.minutes * 60 }))!;
    expect(f.lines.find((l) => l.key === 'distance')!.verdict).toBe('on');
  });
});

describe('document merge and sync', () => {
  const plan = planOf('run5k', 'beginner', 3);
  const docA: CoachDoc = { version: 1, plan, planUpdatedAt: 10, done: { [`${plan.id}:0:0`]: { workoutStart: 1, at: 10, manual: false, skipped: false } }, logs: {} };

  test('the newer plan wins whole and the progress of another plan is dropped', () => {
    const other = { ...plan, id: 'p2' };
    const docB: CoachDoc = { version: 1, plan: other, planUpdatedAt: 20, done: { 'p2:0:0': { workoutStart: null, at: 20, manual: true, skipped: false } }, logs: {} };
    const merged = mergeCoachDocs(docA, docB);
    expect(merged.plan!.id).toBe('p2');
    expect(Object.keys(merged.done)).toEqual(['p2:0:0']);
    expect(sameCoachDoc(mergeCoachDocs(docB, docA), merged)).toBe(true);
  });

  test('finished sessions merge per key, the later mark wins, and an undo beats the older mark', () => {
    const key = `${plan.id}:0:0`;
    const docB: CoachDoc = { ...docA, done: { [key]: { workoutStart: 1, at: 30, manual: false, skipped: false, cleared: true }, [`${plan.id}:0:1`]: { workoutStart: null, at: 5, manual: true, skipped: false } } };
    const merged = mergeCoachDocs(docA, docB);
    expect(merged.done[key]!.cleared).toBe(true);
    expect(Object.keys(merged.done).sort()).toEqual([key, `${plan.id}:0:1`].sort());
  });

  test('ending a plan wins over an older plan and keeps the end', () => {
    const ended: CoachDoc = { version: 1, plan: null, planUpdatedAt: 99, done: {}, logs: {} };
    expect(mergeCoachDocs(docA, ended).plan).toBeNull();
  });

  function io(
    local: CoachDoc,
    remote: RemoteCoach,
    put: (baseRev: number, doc: CoachDoc) => PutResult,
    detachedAt: number | null = null,
  ): CoachSyncIo & { local: () => CoachDoc; puts: number } {
    let stored = local;
    const state = { puts: 0 };
    return {
      detachedAt: async () => detachedAt,
      fetchRemote: async () => remote,
      putRemote: async (baseRev, doc) => {
        state.puts += 1;
        return put(baseRev, doc);
      },
      readLocal: async () => stored,
      writeLocal: async (doc) => {
        stored = doc;
      },
      local: () => stored,
      get puts() {
        return state.puts;
      },
    };
  }

  test('a new phone downloads the plan; nothing is uploaded back', async () => {
    const harness = io(EMPTY_COACH_DOC, { rev: 3, doc: docA }, () => ({ status: 'ok', rev: 4 }));
    expect(await syncCoachDoc(harness)).toBe('downloaded');
    expect(harness.local().plan!.id).toBe(plan.id);
    expect(harness.puts).toBe(0);
  });

  test('local changes upload; an identical cloud copy is left alone; empty with empty is unchanged', async () => {
    expect(await syncCoachDoc(io(docA, { rev: 0, doc: null }, () => ({ status: 'ok', rev: 1 })))).toBe('uploaded');
    const same = io(docA, { rev: 2, doc: docA }, () => ({ status: 'ok', rev: 3 }));
    expect(await syncCoachDoc(same)).toBe('unchanged');
    expect(same.puts).toBe(0);
    expect(await syncCoachDoc(io(EMPTY_COACH_DOC, { rev: 0, doc: null }, () => ({ status: 'ok', rev: 1 })))).toBe('unchanged');
  });

  test('a free account keeps its changes local; a conflict is merged again', async () => {
    expect(await syncCoachDoc(io(docA, { rev: 0, doc: null }, () => ({ status: 'locked' })))).toBe('local-only');
    let calls = 0;
    const result = await syncCoachDoc(
      io(docA, { rev: 1, doc: { ...docA, planUpdatedAt: 5 } }, () => (++calls === 1 ? { status: 'conflict', rev: 2, doc: null } : { status: 'ok', rev: 3 })),
    );
    expect(result).toBe('uploaded');
    expect(calls).toBe(2);
  });
  const old: CoachDoc = { version: 1, plan: { ...plan, id: 'p1' }, planUpdatedAt: 100, done: { 'p1:0:0': { workoutStart: 1, at: 150, manual: false, skipped: false } }, logs: {} };
  const ok = () => ({ status: 'ok', rev: 1 }) as PutResult;

  test('the newest change is the plan, a finished session or a log', () => {
    expect(newestCoachChange(old)).toBe(150);
    expect(newestCoachChange({ ...old, logs: { 'p1:0:1': { at: 400, exercises: [] } } })).toBe(400);
    expect(newestCoachChange(EMPTY_COACH_DOC)).toBe(0);
  });

  test('a plan not newer than the detach is not pushed, even to an empty cloud', async () => {
    const harness = io(old, { rev: 0, doc: null }, ok, 150);
    expect(await syncCoachDoc(harness)).toBe('local-only');
    expect(harness.puts).toBe(0);
  });

  test('a tick made after the detach uploads the document', async () => {
    const edited: CoachDoc = { ...old, done: { ...old.done, 'p1:0:1': { workoutStart: null, at: 151, manual: true, skipped: false } } };
    const harness = io(edited, { rev: 0, doc: null }, ok, 150);
    expect(await syncCoachDoc(harness)).toBe('uploaded');
    expect(harness.puts).toBe(1);
  });

  test('the new account plan is still downloaded', async () => {
    const theirs: CoachDoc = { ...old, planUpdatedAt: 900, done: {} };
    const harness = io(EMPTY_COACH_DOC, { rev: 2, doc: theirs }, ok, 150);
    expect(await syncCoachDoc(harness)).toBe('downloaded');
    expect(harness.puts).toBe(0);
    expect(harness.local().planUpdatedAt).toBe(900);
  });
});

describe('strength plans', () => {
  const strengthChoice = (setting: 'home' | 'gym', level: PlanLevel, days: number): PlanChoice => ({
    kind: 'strength',
    goal: 'strengthFull',
    level,
    daysPerWeek: days,
    setting,
    weekdays: defaultWeekdays(days),
  });
  const planFor = (setting: 'home' | 'gym', level: PlanLevel, days: number) => buildPlan(strengthChoice(setting, level, days), dayStartSec(MONDAY) * 1000 + 6 * 3600_000);

  test('every setting, level and weekly count builds 8 weeks of full-body sessions from real library exercises', async () => {
    const { exerciseById } = await import('./exercises');
    for (const setting of ['home', 'gym'] as const) {
      for (const level of ['beginner', 'intermediate', 'advanced'] as PlanLevel[]) {
        for (const days of [2, 3]) {
          const weeks = generatePlan(planFor(setting, level, days));
          expect(weeks.length).toBe(8);
          for (const week of weeks) {
            expect(week.sessions.length).toBe(days);
            for (const s of week.sessions) {
              expect(s.kind).toBe('strength');
              const list = s.strength!.exercises;
              expect(list.length).toBeGreaterThanOrEqual(4);
              expect(new Set(list.map((e) => e.exerciseId)).size).toBe(list.length);
              for (const e of list) {
                const def = exerciseById(e.exerciseId);
                expect(def).toBeDefined();
                expect(def![setting]).toBe(true);
                expect(e.sets).toBeGreaterThanOrEqual(1);
                expect(def!.timed ? e.seconds! > 0 : e.reps > 0).toBe(true);
              }
              expect(s.minutes).toBeGreaterThanOrEqual(15);
            }
          }
        }
      }
    }
  });

  test('home sessions use bodyweight where the library has it; sessions of one week differ; week 4 is lighter', async () => {
    const { exerciseById } = await import('./exercises');
    const weeks = generatePlan(planFor('home', 'beginner', 3));
    const a = weeks[0]!.sessions[0]!.strength!.exercises.map((e) => e.exerciseId);
    const b = weeks[0]!.sessions[1]!.strength!.exercises.map((e) => e.exerciseId);
    expect(a).not.toEqual(b);
    expect(exerciseById(a[0]!)!.equipment).toBe('bodyweight');
    expect(weeks[3]!.phase).toBe('cutback');
    const sets = (w: number) => weeks[w]!.sessions[0]!.strength!.exercises[0]!.sets;
    expect(sets(3)).toBeLessThan(sets(2));
    expect(sets(2)).toBeGreaterThan(sets(0));
  });

  test('the weekly scale cuts the sets', () => {
    const plan = planFor('gym', 'advanced', 3);
    const scaled = generatePlan({ ...plan, adjust: { '1': { scalePct: 75, reason: 'overreaching', at: 0 } } });
    expect(scaled[1]!.sessions[0]!.strength!.exercises[0]!.sets).toBeLessThan(generatePlan(plan)[1]!.sessions[0]!.strength!.exercises[0]!.sets);
  });
});
