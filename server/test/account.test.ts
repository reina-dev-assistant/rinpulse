import { describe, expect, it } from "vitest";

import { call, env, grantApi, signUp } from "./helpers";

async function seed(userId: string) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user_state (user_id, rev, last_sync_at) VALUES (?1, 1, 1)").bind(userId),
    env.DB.prepare(
      "INSERT INTO step_samples (user_id, timestamp, steps, calories, distance, rev, updated_at) VALUES (?1, 60, 5, 1, 1, 1, 1)",
    ).bind(userId),
    env.DB.prepare(
      "INSERT INTO sleep_segments (user_id, start, \"end\", type, rev, updated_at) VALUES (?1, 1, 2, 1, 1, 1)",
    ).bind(userId),
    env.DB.prepare(
      `INSERT INTO workouts (user_id, start, workout_number, "end", sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, point_count, rev, updated_at)
       VALUES (?1, 10, 1, 20, 1, 'Run', 10, 1, 1, 1, '{}', 1, 1, 1, 1)`,
    ).bind(userId),
    env.DB.prepare("INSERT INTO workout_points (user_id, workout_start, seq, ts) VALUES (?1, 10, 0, 10)").bind(userId),
    env.DB.prepare("INSERT INTO device (user_id, address, name, rev, updated_at) VALUES (?1, 'AA', 'Watch', 1, 1)").bind(userId),
    env.DB.prepare(
      "INSERT INTO imports (id, user_id, r2_key, status, created_at) VALUES (?1, ?2, ?3, 'uploaded', 1)",
    ).bind(`import-${userId}`, userId, `imports/${userId}/file`),
    env.DB.prepare("INSERT INTO gear_doc (user_id, doc, rev, updated_at) VALUES (?1, '{}', 1, 1)").bind(userId),
    env.DB.prepare(
      "INSERT INTO web_watchfaces (id, user_id, name, filename, size, sha256, created_at) VALUES (?1, ?2, 'Face', 'face.hwt', 3, 'abc', 1)",
    ).bind(`face-${userId}`, userId),
    env.DB.prepare(
      "INSERT INTO studio_projects (id, user_id, name, rev, size, thumb, doc_key, created_at, updated_at) VALUES (?1, ?2, 'Project', 1, 2, NULL, ?3, 1, 1)",
    ).bind(`project-${userId}`, userId, `studio/${userId}/project-${userId}/doc`),
  ]);
  await env.IMPORTS.put(`imports/${userId}/file`, "zip");
  await env.IMPORTS.put(`watchfaces/${userId}/face-${userId}`, "hwt");
  await env.IMPORTS.put(`watchfaces/${userId}/second`, "hwt");
  await env.IMPORTS.put(`studio/${userId}/project-${userId}/doc`, "{}");
  await env.IMPORTS.put(`studio/${userId}/project-${userId}/older`, "{}");
}

async function rows(table: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`).bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

const TABLES = ["user_state", "step_samples", "sleep_segments", "workouts", "workout_points", "device", "imports", "gear_doc", "web_watchfaces", "studio_projects"];

const watchfaceFiles = async (userId: string) => (await env.IMPORTS.list({ prefix: `watchfaces/${userId}/` })).objects.length;
const studioFiles = async (userId: string) => (await env.IMPORTS.list({ prefix: `studio/${userId}/` })).objects.length;

describe("DELETE /v1/account", () => {
  it("requires a session", async () => {
    expect((await call("/v1/account", { method: "DELETE" })).status).toBe(401);
  });

  it("deletes the caller's rows and files and leaves other users alone", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    await seed(alice.user.id);
    await seed(bob.user.id);
    grantApi.handler = () => Response.json({ revoked: true });

    const response = await call("/v1/account", { method: "DELETE", cookie: alice.cookie });
    expect(grantApi.calls.map((c) => [c.action, c.body.userId])).toEqual([["disconnect", alice.user.id]]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });

    for (const table of TABLES) {
      expect(await rows(table, alice.user.id), table).toBe(0);
      expect(await rows(table, bob.user.id), table).toBe(1);
    }
    expect(await env.IMPORTS.get(`imports/${alice.user.id}/file`)).toBeNull();
    expect(await watchfaceFiles(alice.user.id)).toBe(0);
    expect(await watchfaceFiles(bob.user.id)).toBe(2);
    expect(await studioFiles(alice.user.id)).toBe(0);
    expect(await studioFiles(bob.user.id)).toBe(2);
    expect(await env.IMPORTS.get(`imports/${bob.user.id}/file`)).not.toBeNull();
  });

  it("works for an account with nothing stored", async () => {
    const { cookie } = signUp("carol");
    grantApi.handler = () => Response.json({ revoked: true });
    expect((await call("/v1/account", { method: "DELETE", cookie })).status).toBe(200);
  });
});

describe("DELETE /v1/data", () => {
  it("requires a session", async () => {
    expect((await call("/v1/data", { method: "DELETE" })).status).toBe(401);
  });

  it("wipes the synced rows and imported files of the caller only, and never touches the Strava connection", async () => {
    const dana = signUp("dana");
    const erin = signUp("erin");
    await seed(dana.user.id);
    await seed(erin.user.id);
    grantApi.handler = () => Response.json({ revoked: true });

    const response = await call("/v1/data", { method: "DELETE", cookie: dana.cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(grantApi.calls).toEqual([]);

    for (const table of TABLES) {
      expect(await rows(table, dana.user.id), table).toBe(0);
      expect(await rows(table, erin.user.id), table).toBe(1);
    }
    expect(await env.IMPORTS.get(`imports/${dana.user.id}/file`)).toBeNull();
    expect(await watchfaceFiles(dana.user.id)).toBe(0);
    expect(await watchfaceFiles(erin.user.id)).toBe(2);
    expect(await studioFiles(dana.user.id)).toBe(0);
    expect(await studioFiles(erin.user.id)).toBe(2);
    expect(await env.IMPORTS.get(`imports/${erin.user.id}/file`)).not.toBeNull();
  });
});
