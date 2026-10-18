-- Ride game leaderboard (server/src/ride/leaderboard.ts). One row per accepted finish; the board shows each rider's best.
CREATE TABLE ride_result (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- "First L." from the JoyoRogo profile at submission time; NULL when the profile has no name.
  display_name TEXT,
  anon INTEGER NOT NULL DEFAULT 0,
  route_id TEXT NOT NULL,
  -- YYYY-MM-DD in WIB, the daily challenge's day.
  day TEXT NOT NULL,
  time_s REAL NOT NULL,
  dist_m REAL NOT NULL,
  avg_cad REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX ride_result_route_time ON ride_result (route_id, time_s);
CREATE INDEX ride_result_route_day_time ON ride_result (route_id, day, time_s);
CREATE INDEX ride_result_user ON ride_result (user_id, created_at);
