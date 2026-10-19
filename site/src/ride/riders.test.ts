import { describe, expect, test } from "bun:test";

import { DRAFT_CDA_SCALE, Peloton, RIDER_LAT, draftScale, makeBots, type BotSpec } from "./riders.ts";
import { ROUTES } from "./routes.ts";
import { RideSession } from "./session.ts";
import { Track } from "./track.ts";

const pantai = ROUTES.find((r) => r.id === "pantai")!;

function bot(name: string, wkg: number, startM: number, homeLat = -1.6): BotSpec {
  return { name, kg: 70, wkg, jersey: 0xffffff, homeLat, startM };
}

describe("draftScale", () => {
  test("full shelter close behind, fading to none at 12 m, none ahead or alongside", () => {
    expect(draftScale(3)).toBeCloseTo(DRAFT_CDA_SCALE);
    expect(draftScale(8)).toBeGreaterThan(DRAFT_CDA_SCALE);
    expect(draftScale(8)).toBeLessThan(1);
    expect(draftScale(12.5)).toBe(1);
    expect(draftScale(0.5)).toBe(1);
    expect(draftScale(-3)).toBe(1);
  });
});

describe("Peloton", () => {
  test("the same route always gets the same bots", () => {
    expect(makeBots(pantai)).toEqual(makeBots(pantai));
  });

  test("a stronger bot stuck behind a slower one in the same line pulls out and passes", () => {
    const peloton = new Peloton(pantai, new Track(pantai), [bot("slow", 2, 20), bot("strong", 4, 16)], false);
    for (let i = 0; i < 4 * 240; i++) peloton.step(0.25, null);
    const [slow, strong] = peloton.bots;
    expect(strong!.distM).toBeGreaterThan(slow!.distM + 50);
  });

  test("a bot never rides through a slower rider in its line", () => {
    const peloton = new Peloton(pantai, new Track(pantai), [bot("chaser", 3, 0)], false);
    // The player crawls 6 m ahead and keeps moving into the bot's line, so the bot cannot get by and must hold back.
    let playerM = 6;
    for (let i = 0; i < 4 * 60; i++) {
      peloton.step(0.25, { distM: playerM, lat: peloton.bots[0]!.lat, speedMs: 2 });
      playerM += 0.5;
      expect(playerM - peloton.bots[0]!.distM).toBeGreaterThan(1);
    }
  });

  test("the player shelters behind a bot a few metres up the road", () => {
    const s = new RideSession(pantai, new Track(pantai), { ghost: null, segmentBests: {}, bots: [bot("pacer", 3, 3, RIDER_LAT)] });
    s.startCountdown();
    s.step(5, {});
    s.speedMs = 8;
    s.peloton.bots[0]!.speedMs = 8;
    s.step(0.05, { cad: 85 });
    expect(s.drafting).toBe(true);
    expect(s.cdaScale).toBeLessThan(0.8);
  });
});
