import { describe, expect, it } from "vitest";

import { clearAccessCache } from "../src/access";
import { MAX_STUDIO_BODY_BYTES, MAX_STUDIO_PROJECTS_PER_USER } from "../src/limits";
import { call, env, founders, signUp } from "./helpers";

interface Meta {
  id: string;
  name: string;
  rev: number;
  size: number;
  createdAt: number;
  updatedAt: number;
  thumb: string | null;
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const doc = (extra: Record<string, unknown> = {}) => ({
  format: "joyofit-studio-project",
  project: { version: 1, layers: [], ...extra },
  assets: { a1: { name: "bg.png", dataUrl: PNG } },
});

/** A request with the `Content-Length` the Worker requires; `body` is JSON-encoded unless it is a string. */
const send = (method: string, path: string, cookie: string | undefined, body?: unknown) => {
  const text = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return call(`/v1/studio/projects${path}`, {
    method,
    ...(text === undefined ? {} : { body: text, headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(text).byteLength) } }),
    ...(cookie ? { cookie } : {}),
  });
};

const create = async (cookie: string, name = "My face", extra: Record<string, unknown> = {}): Promise<Meta> => {
  const response = await send("POST", "", cookie, { name, document: doc(), ...extra });
  expect(response.status).toBe(201);
  return (await response.json()) as Meta;
};

const rowCount = async (userId: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM studio_projects WHERE user_id = ?1").bind(userId).first<{ n: number }>())?.n ?? 0;
const objects = async (userId: string) => (await env.IMPORTS.list({ prefix: `studio/${userId}/` })).objects.map((o) => o.key);
const docKey = async (id: string) => (await env.DB.prepare("SELECT doc_key FROM studio_projects WHERE id = ?1").bind(id).first<{ doc_key: string }>())?.doc_key;

async function insertRows(userId: string, count: number): Promise<void> {
  await env.DB.batch(
    Array.from({ length: count }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO studio_projects (id, user_id, name, rev, size, thumb, doc_key, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 2, NULL, ?4, ?5, ?5)",
      ).bind(`row-${userId}-${i}`, userId, `Row ${i}`, `studio/${userId}/row-${userId}-${i}/k`, 1_000 + i),
    ),
  );
}

describe("access", () => {
  it("answers 401 on every route without a session", async () => {
    const { cookie } = signUp("alice");
    const { id } = await create(cookie);
    const body = { name: "x", document: doc() };
    expect((await send("GET", "", undefined)).status).toBe(401);
    expect((await send("POST", "", undefined, body)).status).toBe(401);
    expect((await send("GET", `/${id}`, undefined)).status).toBe(401);
    expect((await send("PUT", `/${id}`, undefined, { rev: 1, name: "y" })).status).toBe(401);
    expect((await send("DELETE", `/${id}`, undefined)).status).toBe(401);
  });

  it("answers 402 founder_required to POST and PUT from a non-Pro account, and stores nothing", async () => {
    const free = signUp("free", { founder: false });
    const post = await send("POST", "", free.cookie, { name: "x", document: doc() });
    expect(post.status).toBe(402);
    expect(await post.json()).toEqual({ error: "founder_required", paywall: true });
    expect(await rowCount(free.user.id)).toBe(0);
    expect(await objects(free.user.id)).toEqual([]);

    const owner = signUp("owner");
    const { id } = await create(owner.cookie, "Keep");
    const put = await send("PUT", `/${id}`, free.cookie, { rev: 1, name: "Hijack" });
    expect(put.status).toBe(402);
    expect(await put.json()).toEqual({ error: "founder_required", paywall: true });
  });

  it("keeps list, read and delete open to a lapsed Pro account", async () => {
    const user = signUp("lapsed");
    const meta = await create(user.cookie, "Saved");
    // The same account stops being Pro (the session stays valid).
    founders.delete(user.user.id);
    clearAccessCache();

    const list = await send("GET", "", user.cookie);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { projects: Meta[] }).projects.map((p) => p.id)).toEqual([meta.id]);
    const read = await send("GET", `/${meta.id}`, user.cookie);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { document: unknown }).document).toEqual(doc());
    expect((await send("PUT", `/${meta.id}`, user.cookie, { rev: 1, name: "x" })).status).toBe(402);
    expect((await send("DELETE", `/${meta.id}`, user.cookie)).status).toBe(200);
    expect(await rowCount(user.user.id)).toBe(0);
    expect(await objects(user.user.id)).toEqual([]);
  });
});

describe("POST /v1/studio/projects", () => {
  it("stores the document in R2 under studio/<user>/<id>/<uuid>, records a row and answers 201 with the meta", async () => {
    const { user, cookie } = signUp("alice");
    const document = doc({ title: "Ünïcode" });
    const response = await send("POST", "", cookie, { name: "  My face  ", thumb: PNG, document });
    expect(response.status).toBe(201);
    const json = (await response.json()) as Meta;
    expect(Object.keys(json).sort()).toEqual(["createdAt", "id", "name", "rev", "size", "thumb", "updatedAt"]);
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    expect(json).toMatchObject({ name: "My face", rev: 1, size: bytes.byteLength, thumb: PNG });
    expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.createdAt).toBeGreaterThan(Date.now() - 60_000);
    expect(json.updatedAt).toBe(json.createdAt);

    const key = await docKey(json.id);
    expect(key).toMatch(new RegExp(`^studio/${user.id}/${json.id}/[0-9a-f-]{36}$`));
    expect(await objects(user.id)).toEqual([key]);
    expect(await (await env.IMPORTS.get(key as string))?.json()).toEqual(document);
    expect(await env.DB.prepare("SELECT * FROM studio_projects WHERE id = ?1").bind(json.id).first()).toMatchObject({
      user_id: user.id,
      name: "My face",
      rev: 1,
      size: bytes.byteLength,
      thumb: PNG,
      created_at: json.createdAt,
      updated_at: json.createdAt,
    });
  });

  it("defaults thumb to null and accepts assets being absent", async () => {
    const { cookie } = signUp("alice");
    const response = await send("POST", "", cookie, { name: "Bare", document: { format: "joyofit-studio-project", project: { version: 2 } } });
    expect(response.status).toBe(201);
    expect(((await response.json()) as Meta).thumb).toBeNull();
    const explicit = await send("POST", "", cookie, { name: "Null", thumb: null, document: doc() });
    expect(explicit.status).toBe(201);
    expect(((await explicit.json()) as Meta).thumb).toBeNull();
  });

  describe("rejects with 400 invalid_body", () => {
    const longThumb = (length: number) => `data:image/png;base64,${"A".repeat(length - "data:image/png;base64,".length)}`;
    const cases: [string, Record<string, unknown>][] = [
      ["a missing name", { document: doc() }],
      ["an empty name", { name: "", document: doc() }],
      ["a blank name", { name: "   ", document: doc() }],
      ["a name over 80 characters", { name: "x".repeat(81), document: doc() }],
      ["a non-string name", { name: 5, document: doc() }],
      ["a missing document", { name: "x" }],
      ["a null document", { name: "x", document: null }],
      ["an array document", { name: "x", document: [] }],
      ["a string document", { name: "x", document: "{}" }],
      ["a wrong format", { name: "x", document: { ...doc(), format: "other" } }],
      ["a missing project", { name: "x", document: { format: "joyofit-studio-project" } }],
      ["a non-object project", { name: "x", document: { format: "joyofit-studio-project", project: [] } }],
      ["a project without a numeric version", { name: "x", document: { format: "joyofit-studio-project", project: { version: "1" } } }],
      ["array assets", { name: "x", document: { ...doc(), assets: [] } }],
      ["null assets", { name: "x", document: { ...doc(), assets: null } }],
      ["a non-image thumb", { name: "x", document: doc(), thumb: "hello" }],
      ["an svg thumb", { name: "x", document: doc(), thumb: "data:image/svg+xml;base64,PHN2Zz4=" }],
      ["a thumb that is not base64", { name: "x", document: doc(), thumb: "data:image/png;base64,@@@" }],
      ["an empty base64 thumb", { name: "x", document: doc(), thumb: "data:image/png;base64," }],
      ["a non-string thumb", { name: "x", document: doc(), thumb: 5 }],
      ["a thumb over 16 KiB", { name: "x", document: doc(), thumb: longThumb(16 * 1024 + 1) }],
    ];
    for (const [label, body] of cases) {
      it(label, async () => {
        const { user, cookie } = signUp("alice");
        const response = await send("POST", "", cookie, body);
        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toBe("invalid_body");
        expect(await rowCount(user.id)).toBe(0);
        expect(await objects(user.id)).toEqual([]);
      });
    }

    it("a body that is not an object", async () => {
      const { cookie } = signUp("alice");
      expect((await send("POST", "", cookie, "[]")).status).toBe(400);
      expect((await send("POST", "", cookie, "null")).status).toBe(400);
    });
  });

  it("accepts a thumb of exactly 16 KiB, a name of exactly 80 characters, and the webp and jpeg types", async () => {
    const { cookie } = signUp("alice");
    const prefix = "data:image/webp;base64,";
    const thumb = `${prefix}${"A".repeat(16 * 1024 - prefix.length)}`;
    expect(thumb.length).toBe(16 * 1024);
    expect(((await create(cookie, "x".repeat(80), { thumb })).thumb)).toBe(thumb);
    expect((await create(cookie, "j", { thumb: "data:image/jpeg;base64,/9j/4AAQ" })).thumb).toBe("data:image/jpeg;base64,/9j/4AAQ");
  });

  it("answers 400 invalid_json for a body that is not JSON", async () => {
    const { cookie } = signUp("alice");
    const response = await send("POST", "", cookie, "{nope");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
  });

  it("requires Content-Length (411) and enforces the 5 MiB limit (413 with maxBytes)", async () => {
    const { user, cookie } = signUp("alice");
    const stream = (text: string) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      });
    const noLength = await call("/v1/studio/projects", {
      method: "POST",
      body: stream(JSON.stringify({ name: "x", document: doc() })),
      duplex: "half",
      cookie,
    } as RequestInit & { cookie: string });
    expect(noLength.status).toBe(411);
    expect(await noLength.json()).toEqual({ error: "content_length_required" });

    expect(MAX_STUDIO_BODY_BYTES).toBe(5 * 1024 * 1024);
    const big = JSON.stringify({ name: "x", document: doc({ pad: "a".repeat(MAX_STUDIO_BODY_BYTES) }) });
    const declared = await send("POST", "", cookie, big);
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "too_large", maxBytes: MAX_STUDIO_BODY_BYTES });

    // A Content-Length that understates the stream is caught while reading.
    const lying = await call("/v1/studio/projects", {
      method: "POST",
      body: stream(big),
      duplex: "half",
      headers: { "content-length": "100" },
      cookie,
    } as RequestInit & { cookie: string });
    expect(lying.status).toBe(413);
    expect(await lying.json()).toEqual({ error: "too_large", maxBytes: MAX_STUDIO_BODY_BYTES });
    expect(await rowCount(user.id)).toBe(0);
    expect(await objects(user.id)).toEqual([]);
  });

  it("stores a document just under the limit", async () => {
    const { cookie } = signUp("alice");
    const overhead = JSON.stringify({ name: "x", document: doc({ pad: "" }) }).length;
    const body = JSON.stringify({ name: "x", document: doc({ pad: "a".repeat(MAX_STUDIO_BODY_BYTES - overhead) }) });
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_STUDIO_BODY_BYTES);
    const response = await send("POST", "", cookie, body);
    expect(response.status).toBe(201);
    expect(((await response.json()) as Meta).size).toBeGreaterThan(MAX_STUDIO_BODY_BYTES - 1_000);
  });

  it("caps a library at 100 projects with 409 library_full and keeps no object for the refused one", async () => {
    expect(MAX_STUDIO_PROJECTS_PER_USER).toBe(100);
    const { user, cookie } = signUp("alice");
    await insertRows(user.id, MAX_STUDIO_PROJECTS_PER_USER - 1);
    await create(cookie, "Last place");
    expect(await rowCount(user.id)).toBe(100);

    const refused = await send("POST", "", cookie, { name: "Over", document: doc() });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "library_full", max: 100 });
    expect(await rowCount(user.id)).toBe(100);
    expect(await objects(user.id)).toHaveLength(1);

    const other = signUp("bob");
    await create(other.cookie, "Own library");
  });

  it("lets only one of several concurrent creations take the last place", async () => {
    const { user, cookie } = signUp("alice");
    await insertRows(user.id, MAX_STUDIO_PROJECTS_PER_USER - 1);
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => send("POST", "", cookie, { name: `Race ${i}`, document: doc({ i }) })));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await rowCount(user.id)).toBe(100);
    expect(await objects(user.id)).toHaveLength(1);
  });
});

describe("GET /v1/studio/projects", () => {
  it("lists the caller's metas, newest change first with the id as tiebreak, without documents, with the limits", async () => {
    const { user, cookie } = signUp("alice");
    const other = signUp("bob");
    await create(other.cookie, "Bob's");
    await env.DB.batch(
      [
        ["b", "Older", 1_000],
        ["a", "Tie A", 2_000],
        ["c", "Tie C", 2_000],
        ["d", "Newest", 3_000],
      ].map(([id, name, at]) =>
        env.DB.prepare(
          "INSERT INTO studio_projects (id, user_id, name, rev, size, thumb, doc_key, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 5, ?4, ?5, ?6, ?6)",
        ).bind(id, user.id, name, id === "d" ? PNG : null, `studio/${user.id}/${id}/k`, at),
      ),
    );
    const response = await send("GET", "", cookie);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { projects: (Meta & { document?: unknown })[]; max: number; maxBytes: number };
    expect(json.max).toBe(100);
    expect(json.maxBytes).toBe(5_242_880);
    expect(json.projects.map((p) => p.id)).toEqual(["d", "a", "c", "b"]);
    expect(json.projects[0]).toEqual({ id: "d", name: "Newest", rev: 1, size: 5, createdAt: 3_000, updatedAt: 3_000, thumb: PNG });
    expect(json.projects.every((p) => p.document === undefined)).toBe(true);
  });

  it("answers an empty list for an account with nothing", async () => {
    const { cookie } = signUp("alice");
    expect(await (await send("GET", "", cookie)).json()).toEqual({ projects: [], max: 100, maxBytes: 5_242_880 });
  });
});

describe("GET /v1/studio/projects/:id", () => {
  it("returns the meta with the document, uncached", async () => {
    const { cookie } = signUp("alice");
    const document = doc({ title: "Round trip" });
    const meta = await create(cookie, "Full", { document, thumb: PNG });
    const response = await send("GET", `/${meta.id}`, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ...meta, document });
  });

  it("answers 404 for an unknown id, and for a project whose document is gone", async () => {
    const { cookie } = signUp("alice");
    const unknown = await send("GET", "/nope", cookie);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });
    const meta = await create(cookie);
    await env.IMPORTS.delete((await docKey(meta.id)) as string);
    expect((await send("GET", `/${meta.id}`, cookie)).status).toBe(404);
  });
});

describe("per-user scoping", () => {
  it("hides another user's project from list, read, update and delete, and changes nothing", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const mine = await create(alice.cookie, "Alice's");
    const key = await docKey(mine.id);

    expect(((await (await send("GET", "", bob.cookie)).json()) as { projects: Meta[] }).projects).toEqual([]);
    for (const response of [
      await send("GET", `/${mine.id}`, bob.cookie),
      await send("PUT", `/${mine.id}`, bob.cookie, { rev: 1, name: "Stolen" }),
      await send("PUT", `/${mine.id}`, bob.cookie, { rev: 1, document: doc({ evil: true }) }),
      await send("DELETE", `/${mine.id}`, bob.cookie),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }

    expect(await objects(bob.user.id)).toEqual([]);
    expect(await objects(alice.user.id)).toEqual([key]);
    const row = await env.DB.prepare("SELECT name, rev, doc_key FROM studio_projects WHERE id = ?1").bind(mine.id).first();
    expect(row).toEqual({ name: "Alice's", rev: 1, doc_key: key });
  });
});

describe("PUT /v1/studio/projects/:id", () => {
  it("renames and sets the thumb, bumps rev and keeps the stored object", async () => {
    const { user, cookie } = signUp("alice");
    const meta = await create(cookie, "Before");
    const key = await docKey(meta.id);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await send("PUT", `/${meta.id}`, cookie, { rev: 1, name: "  After  ", thumb: PNG });
    expect(response.status).toBe(200);
    const json = (await response.json()) as Meta;
    expect(json).toMatchObject({ id: meta.id, name: "After", rev: 2, size: meta.size, thumb: PNG, createdAt: meta.createdAt });
    expect(json.updatedAt).toBeGreaterThan(meta.updatedAt);
    expect(await docKey(meta.id)).toBe(key);
    expect(await objects(user.id)).toEqual([key]);
    expect(((await (await send("GET", `/${meta.id}`, cookie)).json()) as { document: unknown }).document).toEqual(doc());

    const cleared = await send("PUT", `/${meta.id}`, cookie, { rev: 2, thumb: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ rev: 3, name: "After", thumb: null });
  });

  it("replaces the document under a fresh key, deletes the old object and leaves exactly one", async () => {
    const { user, cookie } = signUp("alice");
    const meta = await create(cookie, "Doc");
    const oldKey = await docKey(meta.id);
    const next = doc({ title: "Second", pad: "z".repeat(1_000) });

    const response = await send("PUT", `/${meta.id}`, cookie, { rev: 1, document: next });
    expect(response.status).toBe(200);
    const json = (await response.json()) as Meta;
    expect(json).toMatchObject({ rev: 2, name: "Doc", size: new TextEncoder().encode(JSON.stringify(next)).byteLength });
    const newKey = await docKey(meta.id);
    expect(newKey).not.toBe(oldKey);
    expect(newKey).toMatch(new RegExp(`^studio/${user.id}/${meta.id}/[0-9a-f-]{36}$`));
    expect(await objects(user.id)).toEqual([newKey]);
    expect(await env.IMPORTS.get(oldKey as string)).toBeNull();
    expect(((await (await send("GET", `/${meta.id}`, cookie)).json()) as { document: unknown }).document).toEqual(next);
  });

  it("changes name, thumb and document together", async () => {
    const { user, cookie } = signUp("alice");
    const meta = await create(cookie, "Old");
    const response = await send("PUT", `/${meta.id}`, cookie, { rev: 1, name: "New", thumb: PNG, document: doc({ x: 1 }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "New", thumb: PNG, rev: 2 });
    expect(await objects(user.id)).toHaveLength(1);
  });

  it("answers 409 rev_conflict for a stale rev and changes nothing, not even the stored object", async () => {
    const { user, cookie } = signUp("alice");
    const meta = await create(cookie, "Conflict");
    const second = (await (await send("PUT", `/${meta.id}`, cookie, { rev: 1, name: "Two" })).json()) as Meta;
    const key = await docKey(meta.id);
    const before = await env.DB.prepare("SELECT * FROM studio_projects WHERE id = ?1").bind(meta.id).first();

    for (const attempt of [
      { rev: 1, name: "Stale rename" },
      { rev: 1, document: doc({ stale: true }) },
      { rev: 3, thumb: PNG },
    ]) {
      const response = await send("PUT", `/${meta.id}`, cookie, attempt);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "rev_conflict", rev: 2, updatedAt: second.updatedAt });
    }
    expect(await env.DB.prepare("SELECT * FROM studio_projects WHERE id = ?1").bind(meta.id).first()).toEqual(before);
    expect(await objects(user.id)).toEqual([key]);
    expect(((await (await send("GET", `/${meta.id}`, cookie)).json()) as { document: unknown }).document).toEqual(doc());
  });

  it("lets only one of two concurrent PUTs at the same rev win and leaves one object", async () => {
    const { user, cookie } = signUp("alice");
    const meta = await create(cookie, "Race");
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, i) => send("PUT", `/${meta.id}`, cookie, { rev: 1, document: doc({ writer: i }) })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    const winner = (await (await send("GET", `/${meta.id}`, cookie)).json()) as Meta & { document: { project: { writer: number } } };
    expect(winner.rev).toBe(2);
    expect(await objects(user.id)).toEqual([await docKey(meta.id)]);
  });

  it("validates the body: at least one change, rev, name, thumb, document", async () => {
    const { user, cookie } = signUp("alice");
    const meta = await create(cookie, "V");
    const key = await docKey(meta.id);
    const bad: Record<string, unknown>[] = [
      { rev: 1 },
      { name: "x" },
      { rev: 0, name: "x" },
      { rev: 1.5, name: "x" },
      { rev: "1", name: "x" },
      { rev: 1, name: "" },
      { rev: 1, name: "x".repeat(81) },
      { rev: 1, thumb: "data:image/gif;base64,AAAA" },
      { rev: 1, document: null },
      { rev: 1, document: { format: "other", project: { version: 1 } } },
      { rev: 1, document: { format: "joyofit-studio-project", project: {} } },
    ];
    for (const body of bad) {
      const response = await send("PUT", `/${meta.id}`, cookie, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("invalid_body");
    }
    expect((await send("PUT", `/${meta.id}`, cookie, "{nope")).status).toBe(400);
    expect(await objects(user.id)).toEqual([key]);
    expect(await env.DB.prepare("SELECT rev, name FROM studio_projects WHERE id = ?1").bind(meta.id).first()).toEqual({ rev: 1, name: "V" });
  });

  it("requires Content-Length (411) and enforces the 5 MiB limit (413)", async () => {
    const { user, cookie } = signUp("alice");
    const meta = await create(cookie);
    const key = await docKey(meta.id);
    const noLength = await call(`/v1/studio/projects/${meta.id}`, {
      method: "PUT",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ rev: 1, name: "x" })));
          controller.close();
        },
      }),
      duplex: "half",
      cookie,
    } as RequestInit & { cookie: string });
    expect(noLength.status).toBe(411);

    const tooLarge = await send("PUT", `/${meta.id}`, cookie, { rev: 1, document: doc({ pad: "a".repeat(MAX_STUDIO_BODY_BYTES) }) });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: "too_large", maxBytes: MAX_STUDIO_BODY_BYTES });
    expect(await objects(user.id)).toEqual([key]);
  });

  it("answers 404 for an unknown id", async () => {
    const { cookie } = signUp("alice");
    const response = await send("PUT", "/nope", cookie, { rev: 1, name: "x" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

describe("DELETE /v1/studio/projects/:id", () => {
  it("removes the row and every object of the project and leaves the user's other projects", async () => {
    const { user, cookie } = signUp("alice");
    const gone = await create(cookie, "Gone");
    const kept = await create(cookie, "Kept");
    await send("PUT", `/${gone.id}`, cookie, { rev: 1, document: doc({ v: 2 }) });
    // A leftover version (an interrupted replace) is removed with the project.
    await env.IMPORTS.put(`studio/${user.id}/${gone.id}/orphan`, "{}");
    expect(await objects(user.id)).toHaveLength(3);

    const response = await send("DELETE", `/${gone.id}`, cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(await rowCount(user.id)).toBe(1);
    expect(await objects(user.id)).toEqual([await docKey(kept.id)]);
    expect((await send("GET", `/${gone.id}`, cookie)).status).toBe(404);
    expect((await send("DELETE", `/${gone.id}`, cookie)).status).toBe(404);
  });

  it("frees a place in a full library", async () => {
    const { user, cookie } = signUp("alice");
    await insertRows(user.id, MAX_STUDIO_PROJECTS_PER_USER);
    expect((await send("POST", "", cookie, { name: "x", document: doc() })).status).toBe(409);
    expect((await send("DELETE", `/row-${user.id}-0`, cookie)).status).toBe(200);
    expect((await send("POST", "", cookie, { name: "x", document: doc() })).status).toBe(201);
  });
});
