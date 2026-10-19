-- Per-user watch face library (web app and phone): one row per uploaded .hwt, the bytes live in R2 `IMPORTS` at
-- `watchfaces/<user_id>/<id>`. `sha256` is the hex digest of the file; a user cannot store the same file twice.
CREATE TABLE web_watchfaces (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX web_watchfaces_user_sha ON web_watchfaces (user_id, sha256);
CREATE INDEX web_watchfaces_user_created ON web_watchfaces (user_id, created_at DESC);
