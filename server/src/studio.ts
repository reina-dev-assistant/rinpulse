import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { requireFounder } from "./access";
import { readJson } from "./body";
import type { AppContext } from "./env";
import { MAX_STUDIO_BODY_BYTES, MAX_STUDIO_PROJECTS_PER_USER, STUDIO_NAME_MAX, STUDIO_THUMB_MAX } from "./limits";

/**
 * The per-user JoyoFit Studio project library ("save to db"). A project is a Studio `.project.json` document plus
 * metadata: one row per project in `studio_projects`, the document in R2 (`IMPORTS`) under `studio/<userId>/<id>/<uuid>`
 * where `<uuid>` is fresh for every document version (kept in `doc_key`). Mounted at `/v1/studio/projects`, behind
 * `requireUser`. Writing is a Pro benefit (`requireFounder`); listing, reading and deleting are open to every signed-in
 * account, so a lapsed Pro keeps access to what it saved.
 */
export const studio = new Hono<AppContext>();

interface ProjectRow {
  id: string;
  name: string;
  rev: number;
  size: number;
  thumb: string | null;
  doc_key: string;
  created_at: number;
  updated_at: number;
}

const META_COLUMNS = "id, name, rev, size, thumb, created_at, updated_at";

const toMeta = (row: Omit<ProjectRow, "doc_key">) => ({
  id: row.id,
  name: row.name,
  rev: row.rev,
  size: row.size,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  thumb: row.thumb,
});

const r2Prefix = (userId: string, id: string) => `studio/${userId}/${id}/`;

const name = z.string().trim().min(1).max(STUDIO_NAME_MAX);
const thumb = z
  .string()
  .max(STUDIO_THUMB_MAX)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
  .nullable();
/** Shallow on purpose: the client validates the rest of the document. */
const document = z.looseObject({
  format: z.literal("joyofit-studio-project"),
  project: z.looseObject({ version: z.number() }),
  assets: z.looseObject({}).optional(),
});

const createSchema = z.object({ name, thumb: thumb.optional(), document });
const updateSchema = z
  .object({ rev: z.number().int().min(1), name: name.optional(), thumb: thumb.optional(), document: document.optional() })
  .refine((body) => body.name !== undefined || body.thumb !== undefined || body.document !== undefined);

/**
 * Reads the JSON body of a write: `Content-Length` is required (`411`) and at most {@link MAX_STUDIO_BODY_BYTES}
 * (`413 too_large` with `maxBytes`, also when the stream turns out longer than declared).
 */
async function readBody(c: Context<AppContext>): Promise<{ body: unknown } | { response: Response }> {
  const declared = c.req.header("content-length");
  const length = declared === undefined ? NaN : Number(declared);
  if (!Number.isInteger(length)) return { response: c.json({ error: "content_length_required" }, 411) };
  const tooLarge = () => ({ response: c.json({ error: "too_large", maxBytes: MAX_STUDIO_BODY_BYTES }, 413) });
  if (length > MAX_STUDIO_BODY_BYTES) return tooLarge();
  try {
    return { body: await readJson(c.req.raw, MAX_STUDIO_BODY_BYTES) };
  } catch (error) {
    if (error instanceof HTTPException && error.status === 413) return tooLarge();
    throw error;
  }
}

/** The caller's projects, newest change first. Never carries documents. */
studio.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${META_COLUMNS} FROM studio_projects WHERE user_id = ?1 ORDER BY updated_at DESC, id`)
    .bind(c.get("user").id)
    .all<ProjectRow>();
  return c.json({ projects: results.map(toMeta), max: MAX_STUDIO_PROJECTS_PER_USER, maxBytes: MAX_STUDIO_BODY_BYTES });
});

/**
 * POST /v1/studio/projects `{ name, thumb?, document }` — stores a new project at rev 1 and answers `201` with its
 * metadata. The cap of {@link MAX_STUDIO_PROJECTS_PER_USER} is part of the `INSERT`, so concurrent creations cannot
 * overshoot (`409 library_full`).
 */
studio.post("/", requireFounder, async (c) => {
  const user = c.get("user");
  const read = await readBody(c);
  if ("response" in read) return read.response;
  const body = createSchema.parse(read.body);

  const text = JSON.stringify((read.body as { document: unknown }).document);
  const bytes = new TextEncoder().encode(text);
  const id = crypto.randomUUID();
  const key = `${r2Prefix(user.id, id)}${crypto.randomUUID()}`;
  const now = Date.now();
  const thumbValue = body.thumb ?? null;

  await c.env.IMPORTS.put(key, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { userId: user.id },
  });
  try {
    const inserted = await c.env.DB.prepare(
      `INSERT INTO studio_projects (id, user_id, name, rev, size, thumb, doc_key, created_at, updated_at)
       SELECT ?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?7 WHERE (SELECT COUNT(*) FROM studio_projects WHERE user_id = ?2) < ?8`,
    )
      .bind(id, user.id, body.name, bytes.byteLength, thumbValue, key, now, MAX_STUDIO_PROJECTS_PER_USER)
      .run();
    if (inserted.meta.changes === 0) {
      await c.env.IMPORTS.delete(key);
      return c.json({ error: "library_full", max: MAX_STUDIO_PROJECTS_PER_USER }, 409);
    }
  } catch (error) {
    await c.env.IMPORTS.delete(key).catch(() => undefined);
    throw error;
  }
  return c.json(toMeta({ id, name: body.name, rev: 1, size: bytes.byteLength, thumb: thumbValue, created_at: now, updated_at: now }), 201);
});

/** One project with its document; `404` for an id that is not the caller's (or whose document is gone). */
studio.get("/:id", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(`SELECT ${META_COLUMNS}, doc_key FROM studio_projects WHERE id = ?1 AND user_id = ?2`)
    .bind(c.req.param("id"), user.id)
    .first<ProjectRow>();
  const object = row ? await c.env.IMPORTS.get(row.doc_key) : null;
  if (!row || !object) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", "private, no-store");
  return c.json({ ...toMeta(row), document: await object.json() });
});

/**
 * PUT /v1/studio/projects/:id `{ rev, name?, thumb?, document? }` — optimistic update. `rev` is the revision the client
 * last saw; a stale one answers `409 rev_conflict` with the current `rev` and changes nothing. A new document goes to a
 * fresh R2 key first; the conditional `UPDATE` then switches `doc_key`, and the object that lost (the new one on a
 * conflict, the old one on success) is deleted. A rename or thumbnail change keeps the stored object.
 */
studio.put("/:id", requireFounder, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const read = await readBody(c);
  if ("response" in read) return read.response;
  const body = updateSchema.parse(read.body);

  const current = await c.env.DB.prepare("SELECT rev, updated_at, doc_key FROM studio_projects WHERE id = ?1 AND user_id = ?2")
    .bind(id, user.id)
    .first<Pick<ProjectRow, "rev" | "updated_at" | "doc_key">>();
  if (!current) return c.json({ error: "not_found" }, 404);
  const conflict = (rev: number, updatedAt: number) => c.json({ error: "rev_conflict", rev, updatedAt }, 409);
  if (current.rev !== body.rev) return conflict(current.rev, current.updated_at);

  const sets = ["rev = rev + 1", "updated_at = ?4"];
  const params: (string | number | null)[] = [id, user.id, body.rev, Date.now()];
  const set = (column: string, value: string | number | null) => {
    params.push(value);
    sets.push(`${column} = ?${params.length}`);
  };
  if (body.name !== undefined) set("name", body.name);
  if (body.thumb !== undefined) set("thumb", body.thumb);
  let newKey: string | null = null;
  if (body.document !== undefined) {
    const bytes = new TextEncoder().encode(JSON.stringify((read.body as { document: unknown }).document));
    newKey = `${r2Prefix(user.id, id)}${crypto.randomUUID()}`;
    await c.env.IMPORTS.put(newKey, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { userId: user.id },
    });
    set("doc_key", newKey);
    set("size", bytes.byteLength);
  }

  let updated: Omit<ProjectRow, "doc_key"> | null;
  try {
    updated = await c.env.DB.prepare(
      `UPDATE studio_projects SET ${sets.join(", ")} WHERE id = ?1 AND user_id = ?2 AND rev = ?3 RETURNING ${META_COLUMNS}`,
    )
      .bind(...params)
      .first<Omit<ProjectRow, "doc_key">>();
  } catch (error) {
    if (newKey) await c.env.IMPORTS.delete(newKey).catch(() => undefined);
    throw error;
  }
  if (!updated) {
    if (newKey) await c.env.IMPORTS.delete(newKey);
    const latest = await c.env.DB.prepare("SELECT rev, updated_at FROM studio_projects WHERE id = ?1 AND user_id = ?2")
      .bind(id, user.id)
      .first<Pick<ProjectRow, "rev" | "updated_at">>();
    return latest ? conflict(latest.rev, latest.updated_at) : c.json({ error: "not_found" }, 404);
  }
  // The row now points at the new object; a failed delete leaves an orphan that the account wipe still removes.
  if (newKey) await c.env.IMPORTS.delete(current.doc_key).catch(() => undefined);
  return c.json(toMeta(updated));
});

/**
 * Removes the row, then every object under the project's R2 prefix (so a document swapped in by a racing PUT is not
 * left behind); `404` when the id is not the caller's.
 */
studio.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const removed = await c.env.DB.prepare("DELETE FROM studio_projects WHERE id = ?1 AND user_id = ?2 RETURNING id")
    .bind(id, user.id)
    .first<{ id: string }>();
  if (!removed) return c.json({ error: "not_found" }, 404);
  const page = await c.env.IMPORTS.list({ prefix: r2Prefix(user.id, id) });
  if (page.objects.length > 0) await c.env.IMPORTS.delete(page.objects.map((o) => o.key));
  return c.json({ deleted: true });
});
