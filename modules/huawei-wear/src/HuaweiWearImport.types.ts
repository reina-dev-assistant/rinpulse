/** What `importHuaweiExport` found and wrote (`HuaweiImportSummary.toJs()` in `HuaweiExportImporter.kt`). */
export interface HuaweiImportSummary {
  /** Data files read to the end. */
  filesRead: number;
  /** Data files the ZIP could not deliver (damaged member). */
  filesFailed: number;
  /** ZIP members that are not Health data files (plans, descriptors, spreadsheets). */
  filesIgnored: number;
  /** Records that were not usable JSON and could not be repaired, plus oversize ones. */
  badRecords: number;
  /** Readings of a known kind whose value was missing or implausible. */
  rejectedSamples: number;
  /** Readings of kinds JoyoFit has no place for (exercise intensity ...). */
  unmappedSamples: number;
  heartRateReadings: number;
  restingHeartRateReadings: number;
  spo2Readings: number;
  stressReadings: number;
  sleepSegmentsFound: number;
  /** One-minute rows added or filled in with heart rate, SpO2, resting heart rate, steps or distance. */
  minutesWritten: number;
  /** Sleep segments added; the rest overlapped nights the watch already synced. */
  sleepSegmentsAdded: number;
  stressAdded: number;
  /**
   * Other `health_metrics` readings (HRV, sleep apnea, skin temperature, arterial stiffness, arrhythmia) found and added; night
   * scores found and added to `sleep_scores`; days of the `.xls` summary found and added as a noon row where the per-minute
   * files had nothing for that day. Absent from the iOS Apple Health import.
   */
  metricsFound?: number;
  metricsAdded?: number;
  sleepScoresFound?: number;
  sleepScoresAdded?: number;
  dayTotalsFound?: number;
  dayTotalsAdded?: number;
  /**
   * Meals found and put in the queue for JoyoRogo now; water days (glasses of 250 ml per local day) found and queued. The rest were
   * queued by an earlier run. Absent from the iOS Apple Health import.
   */
  mealsFound?: number;
  mealsQueued?: number;
  waterDaysFound?: number;
  waterDaysQueued?: number;
  /** What the export says about the person: `heightCm`, `weightKg`, `sex`, `birthYear` (each only when it says it). */
  profile?: { heightCm?: number; weightKg?: number; sex?: 'male' | 'female'; birthYear?: number };
  /** Workouts of an earlier import that had no track or totals and got them now. */
  workoutsUpdated?: number;
  /**
   * Weigh-ins found and added to the scale history (`scale_reading`, with body composition when the export has it). Absent
   * from the iOS Apple Health import, which does not read weight.
   */
  weighInsFound?: number;
  weighInsAdded?: number;
  /**
   * What `rejectedSamples` and `badRecords` were made of, largest first (at most 20 each), and which kinds of readings the export
   * has that JoyoFit does not store, largest first. Absent from the iOS Apple Health import.
   */
  rejectedReasons?: HuaweiImportRejection[];
  badRecordReasons?: { reason: string; count: number }[];
  unmappedKeys?: { key: string; count: number }[];
  workoutsFound: number;
  /** Workouts added; the rest were already on the phone. */
  workoutsAdded: number;
  workoutPointsAdded: number;
  /** Unix seconds of the oldest and newest thing read, null when nothing was read. */
  oldestSec: number | null;
  newestSec: number | null;
  /** True when `cancelHuaweiImport` stopped the run; what was written so far is kept. */
  cancelled: boolean;
}

/** Readings of [key] dropped for [reason] (`no-time`, `no-number`, `out-of-range`, `bad-span`, `no-weight`); [sample] is the first offending value. */
export interface HuaweiImportRejection {
  key: string;
  reason: string;
  sample: string | null;
  count: number;
}

/** Sent while `importHuaweiExport` runs, at most four times a second, and once more with `phase: 'done'`. */
export interface HuaweiImportProgressEvent {
  phase: 'reading' | 'done';
  /** The file being read, without its folder. */
  fileName: string | null;
  /** 1-based index of that file among the data files. */
  fileIndex: number;
  fileCount: number;
  /** 0 to 1 over the uncompressed size of all data files. */
  fraction: number;
  /** The counts so far; the same shape as the final result. */
  summary: HuaweiImportSummary;
}

/** `error.code` of a rejected `importHuaweiExport`, besides `ERR_BUSY` and `ERR_STORAGE`. */
export type HuaweiImportErrorCode = 'ERR_IMPORT_PASSWORD' | 'ERR_IMPORT_FORMAT';
