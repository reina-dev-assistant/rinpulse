import { describe, expect, it } from "vitest";
import { CloudError, MAX_BODY_BYTES, bodyBytes, createCloudApi } from "./api";

interface Call {
  url: string;
  init: RequestInit;
}

const meta = { id: "7b0e6a1c-3c3b-4a39-9a2e-1d8d3b0c9a11", name: "Face", rev: 1, size: 120, createdAt: 1, updatedAt: 2, thumb: null };

/** A fetch that answers from a queue and records what it was asked. */
function fake(...answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const api = (f: ReturnType<typeof fake>) => createCloudApi({ fetch: f.impl, origin: "https://api.test", locale: () => "id" });

async function kind(promise: Promise<unknown>): Promise<CloudError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CloudError);
    return error as CloudError;
  }
  throw new Error("expected a CloudError");
}

describe("requests", () => {
  it("lists with the session cookie, the language and no body", async () => {
    const f = fake(json({ projects: [meta], max: 100, maxBytes: 5242880 }));
    const list = await api(f).list();
    expect(list).toEqual({ projects: [meta], max: 100, maxBytes: 5242880 });
    expect(f.calls[0]!.url).toBe("https://api.test/api/fit/studio/projects");
    expect(f.calls[0]!.init.method).toBe("GET");
    expect(f.calls[0]!.init.credentials).toBe("include");
    expect(f.calls[0]!.init.body).toBeUndefined();
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-locale"]).toBe("id");
    expect(headers["content-type"]).toBeUndefined();
  });

  it("creates with exactly application/json and answers the metadata", async () => {
    const f = fake(json(meta, 201));
    const created = await api(f).create({ name: "Face", thumb: "data:image/jpeg;base64,AAAA", document: { format: "x" } });
    expect(created).toEqual(meta);
    const { init } = f.calls[0]!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Face", thumb: "data:image/jpeg;base64,AAAA", document: { format: "x" } });
  });

  it("leaves the thumbnail out when there is none, and sends null to clear it", async () => {
    const f = fake(json(meta, 201), json(meta));
    await api(f).create({ name: "Face", document: {} });
    expect("thumb" in JSON.parse(f.calls[0]!.init.body as string)).toBe(false);
    await api(f).update(meta.id, { rev: 1, thumb: null });
    expect(JSON.parse(f.calls[1]!.init.body as string)).toEqual({ rev: 1, thumb: null });
  });

  it("gets one project by an encoded id with its document", async () => {
    const f = fake(json({ ...meta, document: { a: 1 } }));
    const project = await api(f).get("a/b");
    expect(project.document).toEqual({ a: 1 });
    expect(f.calls[0]!.url).toBe("https://api.test/api/fit/studio/projects/a%2Fb");
  });

  it("updates with the revision held and only the fields given", async () => {
    const f = fake(json({ ...meta, rev: 2 }));
    const updated = await api(f).update(meta.id, { rev: 1, name: "New" });
    expect(updated.rev).toBe(2);
    expect(f.calls[0]!.init.method).toBe("PUT");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ rev: 1, name: "New" });
  });

  it("deletes", async () => {
    const f = fake(json({ deleted: true }));
    await api(f).remove(meta.id);
    expect(f.calls[0]!.init.method).toBe("DELETE");
    expect(f.calls[0]!.url.endsWith(`/projects/${meta.id}`)).toBe(true);
  });

  it("falls back to the production origin", async () => {
    const f = fake(json({ projects: [], max: 100, maxBytes: 5242880 }));
    await createCloudApi({ fetch: f.impl }).list();
    expect(f.calls[0]!.url).toBe("https://api.joyorogo.com/api/fit/studio/projects");
  });
});

describe("cloudAccess", () => {
  it("posts the oRPC envelope and reads the tier", async () => {
    const f = fake(json({ json: { unlocked: true, tier: "founder" } }));
    expect(await api(f).access()).toEqual({ state: "signed-in", unlocked: true, tier: "founder" });
    const { url, init } = f.calls[0]!;
    expect(url).toBe("https://api.test/rpc/fitness/cloudAccess");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"json":{}}');
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("reads a signed-in account without Pro", async () => {
    const f = fake(json({ json: { unlocked: false, tier: "free" } }));
    expect(await api(f).access()).toEqual({ state: "signed-in", unlocked: false, tier: "free" });
  });

  it.each([401, 403, 400])("takes a %i as signed out", async (status) => {
    const f = fake(json({ error: "x" }, status));
    expect(await api(f).access()).toEqual({ state: "signed-out" });
  });

  it("reports an outage, a network failure and a malformed answer instead of guessing", async () => {
    expect((await kind(api(fake(json({}, 503))).access())).kind).toBe("unavailable");
    expect((await kind(api(fake(json({}, 500))).access())).kind).toBe("server");
    expect((await kind(api(fake(new TypeError("failed"))).access())).kind).toBe("network");
    expect((await kind(api(fake(json({ json: { tier: "x" } }))).access())).kind).toBe("server");
  });
});

describe("error mapping", () => {
  it.each([
    [401, { error: "unauthorized" }, "unauthorized"],
    [402, { error: "founder_required", paywall: true }, "paywall"],
    [404, { error: "not_found" }, "not_found"],
    [502, { error: "fit_api_unreachable" }, "unavailable"],
    [503, { error: "auth_unavailable" }, "unavailable"],
    [500, {}, "server"],
    [409, { error: "something_else" }, "server"],
  ] as const)("%i %j is %s", async (status, body, expected) => {
    const error = await kind(api(fake(json(body, status))).list());
    expect(error.kind).toBe(expected);
    expect(error.status).toBe(status);
  });

  it("carries the revision of a conflict", async () => {
    const error = await kind(api(fake(json({ error: "rev_conflict", rev: 7, updatedAt: 99 }, 409))).update(meta.id, { rev: 3, name: "x" }));
    expect(error).toMatchObject({ kind: "rev_conflict", rev: 7, updatedAt: 99 });
  });

  it("carries the limit of a full library", async () => {
    const error = await kind(api(fake(json({ error: "library_full", max: 100 }, 409))).create({ name: "x", document: {} }));
    expect(error).toMatchObject({ kind: "library_full", max: 100 });
  });

  it("carries the byte limit of a 413, defaulting to 5 MiB", async () => {
    expect(await kind(api(fake(json({ error: "too_large", maxBytes: 1000 }, 413))).create({ name: "x", document: {} }))).toMatchObject({ kind: "too_large", maxBytes: 1000 });
    expect(await kind(api(fake(json({}, 413))).create({ name: "x", document: {} }))).toMatchObject({ kind: "too_large", maxBytes: MAX_BODY_BYTES });
  });

  it("maps a request that never got an answer to network", async () => {
    expect((await kind(api(fake(new TypeError("Failed to fetch"))).list())).kind).toBe("network");
  });

  it("rejects an answer that is not the contract", async () => {
    expect((await kind(api(fake(json({ nope: 1 }))).list())).kind).toBe("server");
    expect((await kind(api(fake(json({ ...meta, document: 1, rev: "x" }))).get(meta.id))).kind).toBe("server");
    expect((await kind(api(fake(new Response("<html>", { status: 200 }))).list())).kind).toBe("server");
  });
});

describe("size check", () => {
  it("counts the body in bytes, not characters", () => {
    expect(bodyBytes("abc")).toBe(3);
    expect(bodyBytes("é")).toBe(2);
  });

  it("refuses a body over the limit without calling the network, reporting the size", async () => {
    const f = fake();
    const document = { blob: "x".repeat(2000) };
    const error = await kind(api(f).create({ name: "x", document }, 1000));
    expect(error).toMatchObject({ kind: "too_large", maxBytes: 1000 });
    expect(error.size).toBeGreaterThan(2000);
    expect(f.calls).toHaveLength(0);
  });

  it("measures the whole body, name and thumbnail included", async () => {
    const f = fake(json(meta, 201));
    const document = { blob: "x".repeat(900) };
    const small = bodyBytes(JSON.stringify({ name: "n", document }));
    await expect(api(f).create({ name: "n", document }, small)).resolves.toBeTruthy();
    const withThumb = api(fake());
    await expect(withThumb.create({ name: "n", thumb: "data:image/jpeg;base64,AAAA", document }, small)).rejects.toMatchObject({ kind: "too_large" });
  });

  it("applies to updates too", async () => {
    const f = fake();
    await expect(api(f).update(meta.id, { rev: 1, document: { blob: "x".repeat(500) } }, 100)).rejects.toMatchObject({ kind: "too_large" });
    expect(f.calls).toHaveLength(0);
  });
});
