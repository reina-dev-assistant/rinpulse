-- JoyoFit Studio cloud projects (Pro): one row per project, the `.project.json` document lives in R2 `IMPORTS` at
-- `studio/<user_id>/<id>/<uuid>`; `doc_key` is the current object and changes with every new document, so a stale
-- writer can never clobber the stored file. `rev` starts at 1 and bumps on every change (optimistic concurrency).
-- `size` is the byte length of the stored document; `thumb` is an optional small `data:image/...;base64,` preview.
CREATE TABLE studio_projects (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rev INTEGER NOT NULL,
  size INTEGER NOT NULL,
  thumb TEXT,
  doc_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX studio_projects_user_updated ON studio_projects (user_id, updated_at DESC);
