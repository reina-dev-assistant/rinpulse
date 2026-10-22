/** What the native import found about the person (`HuaweiImportSummary.profile`) and the profile JoyoFit would save from it. */
export interface ExportProfileHint {
  heightCm?: number;
  weightKg?: number;
  sex?: 'male' | 'female';
  /** The year of the newest weigh-in minus the age it carried: off by one for someone whose birthday had not come yet. */
  birthYear?: number;
}

export interface FilledProfile {
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: 'male' | 'female' | 'unknown';
  dailyStepGoal: number;
}

/**
 * The profile to save when the phone has none (Settings > Profile never saved): the export's height, weight, birth year and sex.
 * Null when the phone already has a profile (its height is never replaced) or the export lacks height, weight or birth year,
 * because the profile cannot be saved without them and making them up would put numbers in front of the watch that nobody gave.
 */
export function profileFromExport(existing: unknown, hint: ExportProfileHint | undefined, dailyStepGoal: number, thisYear: number): FilledProfile | null {
  if (existing != null || !hint) return null;
  const { heightCm, weightKg, birthYear } = hint;
  if (heightCm === undefined || weightKg === undefined || birthYear === undefined) return null;
  if (!Number.isInteger(heightCm) || heightCm < 100 || heightCm > 250) return null;
  if (!(weightKg >= 20 && weightKg <= 300)) return null;
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > thisYear) return null;
  return { heightCm, weightKg, birthYear, sex: hint.sex ?? 'unknown', dailyStepGoal };
}
