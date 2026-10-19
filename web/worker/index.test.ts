import { describe, expect, it } from "vitest";
import worker from "./index";

describe("studio worker", () => {
  const seen: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (req: Request) => {
        seen.push(new URL(req.url).pathname + new URL(req.url).search);
        return new Response("asset");
      },
    },
  };
  const get = (url: string) => worker.fetch(new Request(url), env);

  it("maps /studio/* onto the asset store", async () => {
    seen.length = 0;
    expect(await (await get("https://app.fit.joyorogo.com/studio/")).text()).toBe("asset");
    await get("https://app.fit.joyorogo.com/studio/assets/a-1.js?v=2");
    await get("https://app.fit.joyorogo.com/studio/favicon.svg");
    expect(seen).toEqual(["/", "/assets/a-1.js?v=2", "/favicon.svg"]);
  });

  it("adds the trailing slash to /studio", async () => {
    const res = await get("https://app.fit.joyorogo.com/studio?x=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://app.fit.joyorogo.com/studio/?x=1");
  });

  it("sends everything else to /studio/ without touching the asset store", async () => {
    seen.length = 0;
    for (const url of ["https://joyofit-studio.dzulfikar-at.workers.dev/", "https://x.test/studiox/a", "https://x.test/assets/a.js"]) {
      const res = await get(url);
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/studio/");
    }
    expect(seen).toEqual([]);
  });

  it("does not treat /studio2 or /studiox as Studio", async () => {
    seen.length = 0;
    expect((await get("https://x.test/studio2/x")).status).toBe(302);
    expect(seen).toEqual([]);
  });
});
