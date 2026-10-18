import type { PlanKind } from '../doc';

export type SessionType = 'walkrun' | 'easy' | 'recovery' | 'tempo' | 'intervals' | 'long' | 'race' | 'strength';

export type HrZone = 1 | 2 | 3 | 4 | 5;

export interface RunSpec {
  /** Every running type of `SessionType`. */
  type: Exclude<SessionType, 'strength'>;
  /** Target heart-rate zone (1..5, the app's zones: 50-60 .. 90-100 % of the maximum) of the main part. */
  zone: HrZone;
  /** Distance to cover (the race of a distance plan), null for a plain duration. */
  distanceM: number | null;
  /** Walk/run: alternate `runSec` running and `walkSec` walking `reps` times between a brisk walk warm-up and cool-down. */
  walkRun: { warmupMin: number; runSec: number; walkSec: number; reps: number; cooldownMin: number } | null;
  /** Tempo: a steady comfortably-hard stretch. */
  tempo: { warmupMin: number; mainMin: number; cooldownMin: number } | null;
  /** Intervals: `reps` hard efforts with an easy jog between. */
  intervals: { warmupMin: number; reps: number; workSec: number; restSec: number; cooldownMin: number; workZone: HrZone } | null;
}

export interface PlannedExercise {
  exerciseId: string;
  sets: number;
  /** Repetitions per set; 0 for a timed exercise. */
  reps: number;
  /** Seconds per set for a timed exercise, else null. */
  seconds: number | null;
  restSec: number;
}

export interface StrengthSpec {
  /** Which of the week's full-body sessions: A, B or C. */
  focus: 'A' | 'B' | 'C';
  exercises: PlannedExercise[];
}

export interface PlannedSession {
  /** `<planId>:<week>:<slot>`, the key of `DoneEntry` and `StrengthLog`. */
  key: string;
  week: number;
  slot: number;
  /** Local date `YYYY-MM-DD`. */
  day: string;
  /** 0 = Monday. */
  weekday: number;
  kind: PlanKind;
  type: SessionType;
  /** Planned minutes of the whole session, warm-up and cool-down included. */
  minutes: number;
  /** A session that loads you: tempo, intervals, a long run, a race, a strength session. Never two in a row. */
  hard: boolean;
  run: RunSpec | null;
  strength: StrengthSpec | null;
  /** The weekly adaptation already applied to this session, percent. */
  scalePct: number;
  /** Before the day the plan was made: shown greyed, never counted as missed. */
  beforeStart: boolean;
}

export type WeekPhase = 'build' | 'cutback' | 'taper';

export interface PlannedWeek {
  index: number;
  /** Local date of the Monday. */
  startDay: string;
  phase: WeekPhase;
  scalePct: number;
  sessions: PlannedSession[];
}
