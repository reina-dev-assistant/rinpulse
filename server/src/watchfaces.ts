import { Hono } from "hono";

import { requireFounder } from "./access";
import type { AppContext } from "./env";
import { checkHwt } from "./hwtValidate";
import { cleanFilename } from "./imports";
import { MAX_WATCHFACE_BYTES, MAX_WATCHFACES_PER_USER } from "./limits";

/**
 * The per-user watch face library, shared by the web app and the phone. Files live in R2 (`IMPORTS`) under
 * `watchfaces/<userId>/<id>`, one row per file in `web_watchfaces`. Mounted under `/v1`, behind `requireUser`.
 * Uploading is a Pro benefit (`requireFounder`); listing, downloading and deleting are open to every signed-in account,
 * so nothing is locked away.
 */
export const watchfaces = new Hono<AppContext>();

interface WatchfaceRow {
  id: string;
  name: string;
  filename: string;
  size: number;
  sha256: string;
  created_at: number;
}

const COLUMNS = "id, name, filename, size, sha256, created_at";

const toJson = (row: WatchfaceRow) => ({
  id: row.id,
  name: row.name,
  filename: row.filename,
  size: row.size,
  sha256: row.sha256,
  createdAt: row.created_at,
});

const r2Key = (userId: string, id: string) => `watchfaces/${userId}/${id}`;

/** Reads exactly `length` bytes of the body; null when the stream carries more or fewer. */
async function readBody(body: ReadableStream<Uint8Array>, length: number): Promise<Uint8Array | null> {
  const out = new Uint8Array(length);
  let at = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.byteLength > length) {
      await reader.cancel();
      return null;
    }
    out.set(value, at);
    at += value.byteLength;
  }
  return at === length ? out : null;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The upload name without its last extension, for a face whose package names none. */
function nameFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.trim() === "" ? "watchface" : base;
}

/** `Content-Disposition` for a download: an ASCII `filename` for old clients and the exact name as RFC 5987 `filename*`. */
function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\;%]/g, "_");
  const exact = encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

/**
 * POST /v1/watchfaces?filename=face.hwt — the body is the `.hwt`. `Content-Length` is required and at most
 * {@link MAX_WATCHFACE_BYTES}; the file is buffered (validation needs every byte), checked as a real watch face
 * (`hwtValidate.ts`, `400 invalid_hwt` with a `reason`) and stored. The same file (SHA-256) uploaded again by the same
 * user answers `200` with the existing record and stores nothing; a library of {@link MAX_WATCHFACES_PER_USER} answers
 * `409 library_full`. Answers `201` with the new record.
 */
watchfaces.post("/", requireFounder, async (c) => {
  const user = c.get("user");
  const declared = c.req.header("content-length");
  const length = declared === undefined ? NaN : Number(declared);
  if (!Number.isInteger(length)) return c.json({ error: "content_length_required" }, 411);
  if (length <= 0) return c.json({ error: "empty_body" }, 400);
  if (length > MAX_WATCHFACE_BYTES) return c.json({ error: "too_large", maxBytes: MAX_WATCHFACE_BYTES }, 413);
  const stream = c.req.raw.body;
  if (!stream) return c.json({ error: "empty_body" }, 400);
  const bytes = await readBody(stream, length);
  if (!bytes) return c.json({ error: "length_mismatch" }, 400);

  const sha256 = await sha256Bytes(bytes);
  const existing = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM web_watchfaces WHERE user_id = ?1 AND sha256 = ?2`)
    .bind(user.id, sha256)
    .first<WatchfaceRow>();
  if (existing) return c.json(toJson(existing), 200);

  const checked = checkHwt(bytes);
  if (!checked.ok) return c.json({ error: "invalid_hwt", reason: checked.reason }, 400);

  const filename = cleanFilename(c.req.query("filename")) ?? "watchface.hwt";
  const name = checked.name ?? nameFromFilename(filename);
  const id = crypto.randomUUID();
  const key = r2Key(user.id, id);
  const createdAt = Date.now();

  await c.env.IMPORTS.put(key, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { userId: user.id, sha256 },
  });
  try {
    // The cap is part of the INSERT, so two concurrent uploads cannot both take the last place.
    const inserted = await c.env.DB.prepare(
      `INSERT INTO web_watchfaces (id, user_id, name, filename, size, sha256, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE (SELECT COUNT(*) FROM web_watchfaces WHERE user_id = ?2) < ?8`,
    )
      .bind(id, user.id, name, filename, length, sha256, createdAt, MAX_WATCHFACES_PER_USER)
      .run();
    if (inserted.meta.changes === 0) {
      await c.env.IMPORTS.delete(key);
      return c.json({ error: "library_full", max: MAX_WATCHFACES_PER_USER }, 409);
    }
  } catch (error) {
    await c.env.IMPORTS.delete(key).catch(() => undefined);
    // A concurrent upload of the same file won the unique index (user_id, sha256): answer with its record.
    const winner = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM web_watchfaces WHERE user_id = ?1 AND sha256 = ?2`)
      .bind(user.id, sha256)
      .first<WatchfaceRow>();
    if (winner) return c.json(toJson(winner), 200);
    throw error;
  }
  return c.json({ id, name, filename, size: length, sha256, createdAt }, 201);
});

/** The caller's library, newest first. */
watchfaces.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM web_watchfaces WHERE user_id = ?1 ORDER BY created_at DESC, id`)
    .bind(c.get("user").id)
    .all<WatchfaceRow>();
  return c.json({ watchfaces: results.map(toJson) });
});

/** The stored bytes; `404` for an id that is not the caller's. */
watchfaces.get("/:id/file", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM web_watchfaces WHERE id = ?1 AND user_id = ?2`)
    .bind(c.req.param("id"), user.id)
    .first<WatchfaceRow>();
  const object = row ? await c.env.IMPORTS.get(r2Key(user.id, row.id)) : null;
  if (!row || !object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": attachment(row.filename),
      "Cache-Control": "private, no-store",
    },
  });
});

/** Removes the file and its row; `404` when the id is not the caller's. */
watchfaces.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id FROM web_watchfaces WHERE id = ?1 AND user_id = ?2").bind(id, user.id).first<{ id: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.IMPORTS.delete(r2Key(user.id, id));
  await c.env.DB.prepare("DELETE FROM web_watchfaces WHERE id = ?1 AND user_id = ?2").bind(id, user.id).run();
  return c.json({ deleted: true });
});
