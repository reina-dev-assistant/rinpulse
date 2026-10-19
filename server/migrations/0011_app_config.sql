-- Server-controlled settings the apps read without a session (GET /v1/app-config). Today: the launch-time update gate
-- (docs/force-update.md). Keys: android_min_build, android_latest_build, android_store_url, ios_min_build, ios_latest_build,
-- ios_store_url, message. A missing key means "off" (builds 0) or "default" (store URLs, message), so an empty table gates nobody.
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
