import type { ChatTurn } from './api';
import type { CoachSnapshot } from './snapshot';

/**
 * The prompt for a chat that goes to the wearer's own LLM instead of JoyoRogo's.
 *
 * Upstream's server owns its system prompt, so this file replaces it: the snapshot has to become text the
 * model can read, and the safety rules the server enforced (it keyword-scans for injuries and answers with
 * a fixed reply) have to become instructions instead. They are instructions, not a guarantee - say so in
 * the UI rather than implying the app still screens messages.
 */

/** A chat message as an OpenAI-compatible API takes it, including the system role `ChatTurn` has no room for. */
export interface LocalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The snapshot as compact text. Fields that are null are left out rather than written as "null". */
export function describeSnapshot(snapshot: CoachSnapshot): string {
  const lines: string[] = [];

  const readiness = snapshot.readiness?.headline;
  if (readiness) lines.push(`Readiness: ${readiness}`);
  if (snapshot.load) lines.push(`Load: ${snapshot.load.status} (ratio ${snapshot.load.ratio.toFixed(2)})`);
  if (snapshot.hrv) {
    lines.push(`HRV: ${snapshot.hrv.state} (recent ${Math.round(snapshot.hrv.recentMs)} ms, baseline ${Math.round(snapshot.hrv.baselineMs)} ms)`);
  }
  if (snapshot.sleep) {
    const { lastNightMin, debtMin, needTonightMin } = snapshot.sleep;
    const parts = [
      lastNightMin === null ? null : `last night ${lastNightMin} min`,
      debtMin === null ? null : `debt ${debtMin} min`,
      needTonightMin === null ? null : `needs ${needTonightMin} min tonight`,
    ].filter((part): part is string => part !== null);
    if (parts.length > 0) lines.push(`Sleep: ${parts.join(', ')}`);
  }
  if (snapshot.strain) {
    const parts = [
      snapshot.strain.yesterday === null ? null : `yesterday ${snapshot.strain.yesterday.toFixed(1)}`,
      snapshot.strain.today === null ? null : `today ${snapshot.strain.today.toFixed(1)}`,
      snapshot.strain.avg7 === null ? null : `7-day average ${snapshot.strain.avg7.toFixed(1)}`,
    ].filter((part): part is string => part !== null);
    if (parts.length > 0) lines.push(`Strain: ${parts.join(', ')}`);
  }
  if (snapshot.restingHr !== null) lines.push(`Resting heart rate: ${snapshot.restingHr} bpm`);
  if (snapshot.vo2max !== null) lines.push(`VO2max: ${snapshot.vo2max}`);

  if (snapshot.suggestion) {
    lines.push(`Today's suggestion: ${snapshot.suggestion.text} (${snapshot.suggestion.kind}). Reason: ${snapshot.suggestion.why}`);
  }

  const plan = snapshot.plan;
  if (plan) {
    lines.push(
      `Plan: goal ${plan.goal}, level ${plan.level}, ${plan.daysPerWeek} days a week, week ${plan.week} of ${plan.weeks}, ` +
        `${plan.doneThisWeek}/${plan.plannedThisWeek} done this week (${plan.scalePct}%)`,
    );
    if (plan.next.length > 0) {
      lines.push(`Next sessions: ${plan.next.map((session) => `${session.date} ${session.title}`).join('; ')}`);
    }
  } else {
    lines.push('Plan: none set up yet');
  }

  if (snapshot.workouts.length > 0) {
    const rows = snapshot.workouts.map((workout) => {
      const bits = [workout.sport, `${workout.durationMin} min`];
      if (workout.distanceKm !== null) bits.push(`${workout.distanceKm.toFixed(2)} km`);
      if (workout.avgHr !== null) bits.push(`${workout.avgHr} bpm`);
      if (workout.strain !== null) bits.push(`strain ${workout.strain.toFixed(1)}`);
      if (workout.matchedPlan) bits.push('planned');
      return bits.join(', ');
    });
    lines.push(`Recent workouts (newest first):\n- ${rows.join('\n- ')}`);
  }

  return lines.join('\n');
}

/**
 * The system prompt: what the model is, what it may use, and the limits upstream's server enforced.
 * `today` comes from the snapshot so the model can tell "today" from "yesterday".
 */
export function localSystemPrompt(snapshot: CoachSnapshot): string {
  return [
    'You are a running and strength coach inside a fitness app. You answer in the language the user writes in.',
    'You are not a doctor. If the user mentions pain, an injury, dizziness, chest pain, or anything medical, tell them to stop training and see a doctor or physiotherapist, and do not give a training plan for it.',
    'Be brief: 2 to 5 short sentences, or a short list. No preamble, no repeating the question, no emoji.',
    'Base your answer on the data below. If the data does not answer the question, say so instead of inventing numbers.',
    'Never promise weight loss, a diagnosis, or a medical outcome. Do not prescribe medication or dosages.',
    '',
    `Today is ${snapshot.today}.`,
    '',
    "The user's current data:",
    describeSnapshot(snapshot),
  ].join('\n');
}

/** The conversation as the API takes it: the system prompt first, then the turns the caller kept. */
export function localMessages(snapshot: CoachSnapshot, turns: readonly ChatTurn[]): LocalMessage[] {
  return [{ role: 'system', content: localSystemPrompt(snapshot) }, ...turns];
}
