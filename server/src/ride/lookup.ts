import { DurableObject } from "cloudflare:workers";

interface CodeEntry {
  roomId: string;
  expiresAt: number;
}

interface Window {
  start: number;
  count: number;
}

/**
 * A tiny keyed lookup, one instance per key, so nothing is a global bottleneck and nothing needs KV's eventual consistency:
 * - `code:<six digits>` maps a join code to its room for the code's lifetime (`claim`, `resolve`);
 * - `rl:<what>:<who>` counts calls in a fixed window (`hit`), the REST routes' rate limit.
 * Both clean themselves up with an alarm, so an idle key leaves no storage behind. Every method takes `now` from the caller so tests
 * can move the clock.
 */
export class RideIndex extends DurableObject<Env> {
  /** Claims this code for `roomId` for `ttlMs`; false while the code is still held by another room. */
  async claim(roomId: string, ttlMs: number, now: number): Promise<boolean> {
    const held = await this.ctx.storage.get<CodeEntry>("code");
    if (held && held.expiresAt > now) return false;
    await this.ctx.storage.put("code", { roomId, expiresAt: now + ttlMs } satisfies CodeEntry);
    await this.scheduleCleanup();
    return true;
  }

  /** The room this code opens, or null when the code is unknown or expired. */
  async resolve(now: number): Promise<string | null> {
    const held = await this.ctx.storage.get<CodeEntry>("code");
    return held && held.expiresAt > now ? held.roomId : null;
  }

  /** Counts one call in the current window; `retryAfterMs` is 0 while within `max`, else the wait until the window ends. */
  async hit(max: number, windowMs: number, now: number): Promise<{ ok: boolean; retryAfterMs: number }> {
    let window = await this.ctx.storage.get<Window>("window");
    if (!window || now - window.start >= windowMs) window = { start: now, count: 0 };
    window.count += 1;
    await this.ctx.storage.put("window", window);
    await this.ctx.storage.put("windowEnd", window.start + windowMs);
    await this.scheduleCleanup();
    return window.count <= max ? { ok: true, retryAfterMs: 0 } : { ok: false, retryAfterMs: Math.max(0, window.start + windowMs - now) };
  }

  private async scheduleCleanup(): Promise<void> {
    const [code, windowEnd] = await Promise.all([this.ctx.storage.get<CodeEntry>("code"), this.ctx.storage.get<number>("windowEnd")]);
    const next = Math.max(code?.expiresAt ?? 0, windowEnd ?? 0);
    if (next > 0) await this.ctx.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const [code, windowEnd] = await Promise.all([this.ctx.storage.get<CodeEntry>("code"), this.ctx.storage.get<number>("windowEnd")]);
    if (code && code.expiresAt <= now) await this.ctx.storage.delete("code");
    if (windowEnd !== undefined && windowEnd <= now) await this.ctx.storage.delete(["window", "windowEnd"]);
    await this.scheduleCleanup();
  }
}
