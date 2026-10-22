/**
 * Revision of the numbers `analyzeWorkout` produces (distance, moving time, elevation, pace, ...). The cloud upload
 * (`src/cloud/workoutSync.ts`) stores it with each workout and sends a workout again when its stored revision is lower;
 * bump it whenever a figure changes for the same workout.
 *
 * 2: distance is the watch's total, moving time follows Strava, elevation is smoothed with a hysteresis.
 * 3: pace zones and best-effort ranks take their history from every run of the last 90 days, whatever its sport name.
 * 4: average cadence and step length of a run or walk fall back to the source's summary, then to the step count and speed.
 * 5: a FIT import's fractional cadence counts and a file found to count steps (or a per-leg figure above 130) is no longer doubled.
 * 6: a run or walk without per-sample cadence gets a per-minute cadence series (and the figures that follow from it) from the watch's step samples; the series may carry a measured `stride`.
 * 7: strain, relative effort and training load count in Edwards' fixed %HRmax zones again (documents uploaded while they followed the person's zones are sent again); the zone-time bars stay the person's zones.
 */
export const ANALYSIS_ENGINE_REV = 7;
