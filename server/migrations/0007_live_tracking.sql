-- Live tracking link (docs/bike-computer.md, "Live tracking link"): a phone-recorded ride shared through an unguessable
-- link. Only SHA-256 hashes of the two 128-bit secrets are stored, never a token: `token_hash` is the read capability in
-- the link, `write_hash` is the bearer key the phone posts points with. Times are Unix milliseconds.
CREATE TABLE live_session (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  write_hash TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  -- the last accepted batch (started_at until the first one); the link expires 12 h after it
  last_at INTEGER NOT NULL,
  ended_at INTEGER,
  title TEXT,
  -- rows stored for this session, so a cap needs no COUNT over the points
  point_count INTEGER NOT NULL DEFAULT 0,
  -- per-session write rate limit: the minute bucket and the requests counted in it
  post_minute INTEGER NOT NULL DEFAULT 0,
  post_hits INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
-- One active session per user: starting a ride ends the previous one in the same batch.
CREATE UNIQUE INDEX live_session_one_active ON live_session (user_id) WHERE ended_at IS NULL;
CREATE INDEX live_session_by_user ON live_session (user_id, started_at);
-- No index on last_at: the nightly purge scans this small table (rows older than a day are gone), and every accepted batch updates
-- last_at, so an index would cost one more row written per batch.

CREATE TABLE live_point (
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  alt REAL,
  speed REAL,
  hr INTEGER,
  PRIMARY KEY (session_id, ts)
) WITHOUT ROWID;
