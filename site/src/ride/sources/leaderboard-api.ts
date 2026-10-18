import { relayBase, type RoomInfo } from "./room.ts";

export type Board = "all" | "today";

export interface BoardRow {
  rank: number;
  /** "First L.", or null for an anonymous rider. */
  name: string | null;
  timeS: number;
}

export async function fetchBoard(routeId: string, board: Board, signal?: AbortSignal): Promise<BoardRow[]> {
  const res = await fetch(`${relayBase()}/ride/leaderboard?route=${encodeURIComponent(routeId)}&board=${board}`, { signal });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
  const body = (await res.json()) as { rows: BoardRow[] };
  return body.rows;
}

export type SubmitOutcome = { ok: true; rank: number } | { ok: false; error: string };

/** Sends a finished ride; the relay accepts it only if it saw the phone's cadence for the whole ride. */
export async function submitResult(
  room: RoomInfo,
  result: { routeId: string; timeS: number; distM: number; avgCad: number; anon: boolean },
): Promise<SubmitOutcome> {
  try {
    const res = await fetch(`${relayBase()}/ride/rooms/${encodeURIComponent(room.roomId)}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: room.token, ...result }),
    });
    const body = (await res.json().catch(() => ({}))) as { rank?: number; error?: string };
    return res.ok && typeof body.rank === "number" ? { ok: true, rank: body.rank } : { ok: false, error: body.error ?? `http_${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}
