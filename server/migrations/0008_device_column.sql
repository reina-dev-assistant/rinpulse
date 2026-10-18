-- Which watch produced a row (multi-watch). Nullable, no default: rows from older builds stay NULL.
-- Numbered 0008 on purpose: 0007_live_tracking exists on the unmerged `bikecomp` branch.
ALTER TABLE step_samples ADD COLUMN device TEXT;
ALTER TABLE sleep_segments ADD COLUMN device TEXT;
ALTER TABLE workouts ADD COLUMN device TEXT;
