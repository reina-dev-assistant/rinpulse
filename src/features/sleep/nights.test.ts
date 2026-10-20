import { describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';
import type { SleepSegment, SleepStage } from '@/wear';

import { buildNights, nightHasStages } from './nights';
import { noStagesHint } from './noStagesHint';
import { STAGE_LABELS } from './stageStyle';

const H = 3600;
const START = 1_760_655_600;

describe('a night the watch gave no stages for (Watch Fit 2: only the TruSleep state range)', () => {
  // SleepSync.segmentsFromState: one range of the whole night, raw kind 0x06, no stage.
  const stateRange: SleepSegment = { start: START, end: START + 7 * H, type: 6, stage: null };

  it('is asleep for the whole range and never light', () => {
    const [night] = buildNights([stateRange], []);
    expect(night.periods).toEqual([{ start: START, end: START + 7 * H, stage: 'asleep' }]);
    expect(night.seconds.asleep).toBe(7 * H);
    expect(night.seconds.light).toBe(0);
    expect(night.asleepSeconds).toBe(7 * H);
    expect(night.nap).toBe(false);
    expect(nightHasStages(night)).toBe(false);
    expect(STAGE_LABELS.asleep).toBe('Tidur (tanpa fase)');
  });

  it('a staged night is staged', () => {
    const [night] = buildNights(
      [
        { start: START, end: START + 3 * H, type: 6, stage: 'light' },
        { start: START + 3 * H, end: START + 5 * H, type: 7, stage: 'deep' },
      ],
      [],
    );
    expect(nightHasStages(night)).toBe(true);
  });

  it('stages from the watch win over the state range around them', () => {
    const [night] = buildNights(
      [
        stateRange,
        { start: START + H, end: START + 3 * H, type: 6, stage: 'light' },
        { start: START + 3 * H, end: START + 5 * H, type: 7, stage: 'deep' },
      ],
      [],
    );
    expect(night.seconds.asleep).toBe(0);
    expect(night.seconds.deep).toBe(2 * H);
    expect(nightHasStages(night)).toBe(true);
  });
});

describe('noStagesHint', () => {
  const supported = { heartRate: true, realtimeHeartRate: true, spo2: true, truSleep: true, highHeartRateAlert: true, lowHeartRateAlert: true };

  it('asks to turn TruSleep on when it is off', () => {
    const hint = noStagesHint({ truSleep: false, supported });
    expect(hint.openSettings).toBe(true);
    expect(hint.text).toContain('Nyalakan TruSleep');
  });

  it('with TruSleep on, says the watch gave no stages and that off may give light and deep', () => {
    const hint = noStagesHint({ truSleep: true, supported });
    expect(hint.openSettings).toBe(true);
    expect(hint.text).toContain('tanpa fase');
    expect(hint.text).toContain('saat TruSleep mati');
  });

  it('points nowhere when the watch has no TruSleep command', () => {
    const hint = noStagesHint({ truSleep: true, supported: { ...supported, truSleep: false } });
    expect(hint.openSettings).toBe(false);
  });

  it('keeps the switch reachable while no watch is connected', () => {
    expect(noStagesHint({ truSleep: false, supported: null }).openSettings).toBe(true);
  });
});

describe('English copy', () => {
  it('names stages and hints in English', async () => {
    await applyLocale('en');
    try {
      expect(STAGE_LABELS.asleep).toBe('Sleep (no stages)');
      expect(STAGE_LABELS.deep).toBe('Deep');
      expect(noStagesHint({ truSleep: false, supported: null }).text).toContain('Turn on TruSleep');
    } finally {
      await applyLocale('id');
    }
  });
});

describe('a night whose shape came from the phone\'s own stage estimate', () => {
  // EstimatedSleepStages stores its rows with raw kind 0x5657 and the stage it worked out; src/db/queries.ts marks
  // them `estimated` before they reach here. The watch's own judged-asleep ranges (stage-less) sit around them.
  const estimated = (start: number, end: number, stage: SleepStage): SleepSegment => ({
    start,
    end,
    type: 0x5657,
    stage,
    estimated: true,
  });

  it('is staged, and says it is an estimate', () => {
    const [night] = buildNights(
      [
        { start: START, end: START + 7 * H, type: 6, stage: null },
        estimated(START + H, START + 3 * H, 'light'),
        estimated(START + 3 * H, START + 4 * H, 'deep'),
        estimated(START + 4 * H, START + 7 * H, 'rem'),
      ],
      [],
    );
    expect(nightHasStages(night)).toBe(true);
    expect(night.estimated).toBe(true);
    expect(night.seconds.deep).toBe(H);
    // The stage-less range is not drawn as a stage of its own next to the estimates.
    expect(night.seconds.asleep).toBe(0);
  });

  it('is not an estimate when the watch staged any part of the night itself', () => {
    const [night] = buildNights(
      [
        { start: START, end: START + 3 * H, type: 6, stage: 'light' },
        estimated(START + 3 * H, START + 5 * H, 'deep'),
      ],
      [],
    );
    expect(nightHasStages(night)).toBe(true);
    expect(night.estimated).toBe(false);
  });

  it('a night with no stages at all is not called an estimate', () => {
    const [night] = buildNights([{ start: START, end: START + 7 * H, type: 6, stage: null }], []);
    expect(nightHasStages(night)).toBe(false);
    expect(night.estimated).toBe(false);
  });
});
