import type { Readiness } from '@/features/today/readiness';
import type { SleepSummary } from '@/features/today/stats';
import type { DayStrain } from '@/features/today/strain';

/** The day's numbers the Today sticker is built from. */
export interface DayShareInput {
  steps: number;
  sleep: SleepSummary | null;
  readiness: Readiness;
  strain: DayStrain | null;
}
