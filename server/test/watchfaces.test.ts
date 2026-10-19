import { describe, expect, it } from "vitest";

import { MAX_WATCHFACE_BYTES, MAX_WATCHFACES_PER_USER } from "../src/limits";
import { call, env, signUp } from "./helpers";
import { faceWithBrokenImage, flatFace, nestedFace, utf8, withDeclaredSize, zipOf } from "./hwtFaces";

interface FaceJson {
  id: string;
  name: string;
  filename: string;
  size: number;
  sha256: string;
  createdAt: number;
}

const upload = (cookie: string | undefined, bytes: Uint8Array, filename: string | null = "face.hwt", extra: Record<string, string> = {}) =>
  call(`/v1/watchfaces${filename === null ? "" : `?filename=${encodeURIComponent(filename)}`}`, {
    method: "POST",
    body: bytes,
    headers: { "content-type": "application/octet-stream", "content-length": String(bytes.byteLength), ...extra },
    ...(cookie ? { cookie } : {}),
  });

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

const rowCount = async (userId: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM web_watchfaces WHERE user_id = ?1").bind(userId).first<{ n: number }>())?.n ?? 0;
const objectCount = async (userId: string) => (await env.IMPORTS.list({ prefix: `watchfaces/${userId}/` })).objects.length;

async function insertRows(userId: string, count: number, from = 0): Promise<void> {
  await env.DB.batch(
    Array.from({ length: count }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO web_watchfaces (id, user_id, name, filename, size, sha256, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
      ).bind(`row-${userId}-${from + i}`, userId, `Face ${from + i}`, `face-${from + i}.hwt`, `fake-${userId}-${from + i}`, 1_000 + from + i),
    ),
  );
}

describe("POST /v1/watchfaces", () => {
  it("validates, stores in R2 under watchfaces/<user>/<id>, records a row and answers 201", async () => {
    const { user, cookie } = signUp("alice");
    const bytes = flatFace("Space Red");
    const response = await upload(cookie, bytes, "space-red.hwt");
    expect(response.status).toBe(201);
    const json = (await response.json()) as FaceJson;
    expect(Object.keys(json).sort()).toEqual(["createdAt", "filename", "id", "name", "sha256", "size"]);
    expect(json).toMatchObject({ name: "Space Red", filename: "space-red.hwt", size: bytes.byteLength, sha256: await sha256(bytes) });
    expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.createdAt).toBeGreaterThan(Date.now() - 60_000);

    const row = await env.DB.prepare("SELECT * FROM web_watchfaces WHERE id = ?1").bind(json.id).first();
    expect(row).toMatchObject({ user_id: user.id, name: "Space Red", filename: "space-red.hwt", size: bytes.byteLength, sha256: json.sha256, created_at: json.createdAt });
    const object = await env.IMPORTS.get(`watchfaces/${user.id}/${json.id}`);
    expect(new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(bytes);
  });

  it("names a face after its own title, or after the file when the package has none", async () => {
    const { cookie } = signUp("alice");
    const unicode = (await (await upload(cookie, flatFace("  Pagi\u00a0Cerah \t & <Co>  "), "x.hwt")).json()) as FaceJson;
    expect(unicode.name).toBe("Pagi Cerah & <Co>");
    const untitled = (await (await upload(cookie, flatFace("", { seed: "a" }), "My Face.v2.hwt")).json()) as FaceJson;
    expect(untitled.name).toBe("My Face.v2");
    const noFilename = (await (await upload(cookie, flatFace("", { seed: "b" }), null)).json()) as FaceJson;
    expect(noFilename).toMatchObject({ name: "watchface", filename: "watchface.hwt" });
    const long = (await (await upload(cookie, flatFace("x".repeat(200)), "long.hwt")).json()) as FaceJson;
    expect(long.name).toBe("x".repeat(80));
  });

  it("does not let a filename carry a path or control characters", async () => {
    const { cookie } = signUp("alice");
    const json = (await (await upload(cookie, flatFace("A"), "../../etc/pass\nwd.hwt")).json()) as FaceJson;
    expect(json.filename).toBe(".._.._etc_pass_wd.hwt");
  });

  it("accepts a nested package (watchface.bin inside the watchface entry)", async () => {
    const { cookie } = signUp("alice");
    const response = await upload(cookie, nestedFace("Nested"), "nested.hwt");
    expect(response.status).toBe(201);
    expect(((await response.json()) as FaceJson).name).toBe("Nested");
  });

  it("answers an existing record (200) instead of storing the same file twice, per user", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const bytes = flatFace("Twin");
    const first = await upload(alice.cookie, bytes, "one.hwt");
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as FaceJson;

    const again = await upload(alice.cookie, bytes, "two.hwt");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(firstJson);
    expect(await rowCount(alice.user.id)).toBe(1);
    expect(await objectCount(alice.user.id)).toBe(1);

    const other = await upload(bob.cookie, bytes, "one.hwt");
    expect(other.status).toBe(201);
    expect(((await other.json()) as FaceJson).id).not.toBe(firstJson.id);
    expect(await rowCount(bob.user.id)).toBe(1);
  });

  it("needs a session and Pro, and stores nothing otherwise", async () => {
    expect((await upload(undefined, flatFace("A"))).status).toBe(401);
    const free = signUp("free", { founder: false });
    const response = await upload(free.cookie, flatFace("A"));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "founder_required", paywall: true });
    expect(await rowCount(free.user.id)).toBe(0);
    expect(await objectCount(free.user.id)).toBe(0);
  });

  it("requires Content-Length and enforces the 8 MiB limit", async () => {
    const { cookie } = signUp("alice");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(flatFace("A"));
        controller.close();
      },
    });
    const noLength = await call("/v1/watchfaces", { method: "POST", body: stream, duplex: "half", cookie } as RequestInit & { cookie: string });
    expect(noLength.status).toBe(411);

    expect(MAX_WATCHFACE_BYTES).toBe(8 * 1024 * 1024);
    const tooLarge = await upload(cookie, new Uint8Array(MAX_WATCHFACE_BYTES + 1));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: "too_large", maxBytes: MAX_WATCHFACE_BYTES });

    const empty = await call("/v1/watchfaces", { method: "POST", headers: { "content-length": "0" }, cookie });
    expect(empty.status).toBe(400);
  });

  it("refuses a body whose length differs from Content-Length", async () => {
    const { user, cookie } = signUp("alice");
    const bytes = flatFace("A");
    const short = await call("/v1/watchfaces", {
      method: "POST",
      body: bytes,
      headers: { "content-length": String(bytes.byteLength + 10) },
      cookie,
    });
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "length_mismatch" });
    expect(await rowCount(user.id)).toBe(0);
    expect(await objectCount(user.id)).toBe(0);
  });

  describe("rejects what is not a watch face with 400 invalid_hwt and a reason", () => {
    const cases: [string, () => Uint8Array, RegExp][] = [
      ["random bytes", () => new Uint8Array(500).map((_, i) => (i * 7) % 251), /not a zip/],
      ["a text file", () => utf8("hello, this is not a watch face"), /not a zip/],
      ["a zip without description.xml", () => zipOf({ "readme.txt": utf8("hi") }), /no description\.xml/],
      ["a description with the wrong root", () => zipOf({ "description.xml": utf8("<html><screen>x</screen></html>") }), /root element/],
      ["a description without a screen", () => zipOf({ "description.xml": utf8("<HwTheme><title>x</title></HwTheme>") }), /screen/],
      [
        "a package without the watchface entry",
        () => zipOf({ "description.xml": utf8("<HwTheme><title>x</title><screen>HWHD13</screen></HwTheme>") }),
        /no com\.huawei\.watchface/,
      ],
      [
        "a nested zip without watchface.bin",
        () =>
          zipOf({
            "description.xml": utf8("<HwTheme><title>x</title><screen>HWHD13</screen></HwTheme>"),
            "com.huawei.watchface": zipOf({ "other.txt": utf8("x") }),
          }),
        /without watchface\.bin/,
      ],
      [
        "a watchface entry that is not a watchface binary",
        () =>
          zipOf({
            "description.xml": utf8("<HwTheme><title>x</title><screen>HWHD13</screen></HwTheme>"),
            "com.huawei.watchface": new Uint8Array(40).fill(9),
          }),
        /version|too short|claims/,
      ],
      ["a watchface binary with a broken image", faceWithBrokenImage, /inconsistent.*(magic|offset|binLen|ends)/],
      ["a truncated package", () => flatFace("Cut").slice(0, 200), /./],
      ["a zip that declares a huge unzipped size", () => withDeclaredSize(flatFace("Bomb"), 0x7fffffff), /unzips to more than 32 MiB/],
    ];
    for (const [name, make, reason] of cases) {
      it(name, async () => {
        const { user, cookie } = signUp("alice");
        const response = await upload(cookie, make());
        expect(response.status).toBe(400);
        const json = (await response.json()) as { error: string; reason: string };
        expect(json.error).toBe("invalid_hwt");
        expect(json.reason).toMatch(reason);
        expect(await rowCount(user.id)).toBe(0);
        expect(await objectCount(user.id)).toBe(0);
      });
    }
  });

  it("answers 409 library_full at 40 faces, but still 200 for a face already in the library", async () => {
    const { user, cookie } = signUp("alice");
    const keep = flatFace("Keep");
    const stored = (await (await upload(cookie, keep)).json()) as FaceJson;
    await insertRows(user.id, MAX_WATCHFACES_PER_USER - 1);
    expect(await rowCount(user.id)).toBe(40);

    const full = await upload(cookie, flatFace("One too many"));
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "library_full", max: 40 });
    expect(await rowCount(user.id)).toBe(40);
    expect(await objectCount(user.id)).toBe(1);

    const duplicate = await upload(cookie, keep);
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as FaceJson).id).toBe(stored.id);

    // someone else's library is not full
    const bob = signUp("bob");
    expect((await upload(bob.cookie, flatFace("One too many"))).status).toBe(201);
  });

  it("takes the place of a deleted face", async () => {
    const { user, cookie } = signUp("alice");
    await insertRows(user.id, MAX_WATCHFACES_PER_USER);
    expect((await upload(cookie, flatFace("Late"))).status).toBe(409);
    expect((await call(`/v1/watchfaces/row-${user.id}-0`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await upload(cookie, flatFace("Late"))).status).toBe(201);
  });
});

describe("GET /v1/watchfaces", () => {
  it("lists the caller's faces newest first, with the contract's fields only", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    await insertRows(alice.user.id, 3);
    await insertRows(bob.user.id, 2);
    const response = await call("/v1/watchfaces", { cookie: alice.cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      watchfaces: [2, 1, 0].map((i) => ({
        id: `row-${alice.user.id}-${i}`,
        name: `Face ${i}`,
        filename: `face-${i}.hwt`,
        size: 1,
        sha256: `fake-${alice.user.id}-${i}`,
        createdAt: 1_000 + i,
      })),
    });
  });

  it("is empty for a new account, open to an account without Pro, and needs a session", async () => {
    const free = signUp("free", { founder: false });
    expect(await (await call("/v1/watchfaces", { cookie: free.cookie })).json()).toEqual({ watchfaces: [] });
    await insertRows(free.user.id, 1);
    expect(((await (await call("/v1/watchfaces", { cookie: free.cookie })).json()) as { watchfaces: unknown[] }).watchfaces).toHaveLength(1);
    expect((await call("/v1/watchfaces")).status).toBe(401);
  });
});

describe("GET /v1/watchfaces/:id/file", () => {
  it("returns the stored bytes as an attachment that is never cached", async () => {
    const { cookie } = signUp("alice");
    const bytes = flatFace("Download");
    const stored = (await (await upload(cookie, bytes, "space red.hwt")).json()) as FaceJson;
    const response = await call(`/v1/watchfaces/${stored.id}/file`, { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="space red.hwt"; filename*=UTF-8''space%20red.hwt`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("keeps quotes, semicolons and non-ASCII letters from breaking the header", async () => {
    const { user, cookie } = signUp("alice");
    const filename = 'Pagi "cerah"; \u00e9\u4e2d.hwt';
    await env.DB.prepare("INSERT INTO web_watchfaces (id, user_id, name, filename, size, sha256, created_at) VALUES ('odd', ?1, 'n', ?2, 1, 's', 1)").bind(user.id, filename).run();
    await env.IMPORTS.put(`watchfaces/${user.id}/odd`, "x");
    const response = await call("/v1/watchfaces/odd/file", { cookie });
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Pagi _cerah__ __.hwt"; filename*=UTF-8''Pagi%20%22cerah%22%3B%20%C3%A9%E4%B8%AD.hwt`,
    );
  });

  it("is a 404 for another user's id, an unknown id, or a row whose file is gone", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const stored = (await (await upload(alice.cookie, flatFace("Mine"))).json()) as FaceJson;
    const foreign = await call(`/v1/watchfaces/${stored.id}/file`, { cookie: bob.cookie });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "not_found" });
    expect((await call("/v1/watchfaces/nope/file", { cookie: alice.cookie })).status).toBe(404);
    await env.IMPORTS.delete(`watchfaces/${alice.user.id}/${stored.id}`);
    expect((await call(`/v1/watchfaces/${stored.id}/file`, { cookie: alice.cookie })).status).toBe(404);
    expect((await call(`/v1/watchfaces/${stored.id}/file`)).status).toBe(401);
  });

  it("is readable without Pro (nothing is locked away)", async () => {
    const free = signUp("free", { founder: false });
    await env.DB.prepare("INSERT INTO web_watchfaces (id, user_id, name, filename, size, sha256, created_at) VALUES ('old', ?1, 'n', 'old.hwt', 3, 's', 1)").bind(free.user.id).run();
    await env.IMPORTS.put(`watchfaces/${free.user.id}/old`, "abc");
    const response = await call("/v1/watchfaces/old/file", { cookie: free.cookie });
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("abc");
  });
});

describe("DELETE /v1/watchfaces/:id", () => {
  it("removes the file and the row", async () => {
    const { user, cookie } = signUp("alice");
    const stored = (await (await upload(cookie, flatFace("Gone"))).json()) as FaceJson;
    const response = await call(`/v1/watchfaces/${stored.id}`, { method: "DELETE", cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(await rowCount(user.id)).toBe(0);
    expect(await env.IMPORTS.get(`watchfaces/${user.id}/${stored.id}`)).toBeNull();
    expect((await call(`/v1/watchfaces/${stored.id}`, { method: "DELETE", cookie })).status).toBe(404);
    // the same file can be uploaded again afterwards
    expect((await upload(cookie, flatFace("Gone"))).status).toBe(201);
  });

  it("is a 404 for another user's id and leaves that face alone", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    const stored = (await (await upload(alice.cookie, flatFace("Mine"))).json()) as FaceJson;
    const response = await call(`/v1/watchfaces/${stored.id}`, { method: "DELETE", cookie: bob.cookie });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(await rowCount(alice.user.id)).toBe(1);
    expect(await env.IMPORTS.get(`watchfaces/${alice.user.id}/${stored.id}`)).not.toBeNull();
    expect((await call(`/v1/watchfaces/${stored.id}`, { method: "DELETE" })).status).toBe(401);
  });

  it("works without Pro (a lapsed subscriber can still clean up)", async () => {
    const free = signUp("free", { founder: false });
    await insertRows(free.user.id, 1);
    const response = await call(`/v1/watchfaces/row-${free.user.id}-0`, { method: "DELETE", cookie: free.cookie });
    expect(response.status).toBe(200);
  });
});
