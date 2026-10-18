import { Trophy } from "lucide-react";
import { useEffect, useState } from "react";

import type { Game } from "../game.ts";
import { formatTime } from "../format.ts";
import { useT } from "../i18n.ts";
import { fetchBoard, type Board, type BoardRow } from "../sources/leaderboard-api.ts";
import { useGame } from "./hooks.ts";

type Load = { state: "loading" } | { state: "error" } | { state: "ok"; rows: BoardRow[] };

/** Each rider's best on the selected route, today or all time. Public, read from the relay. */
export function Leaderboard({ game, compact = false }: { game: Game; compact?: boolean }) {
  useGame(game);
  const { t } = useT();
  const [board, setBoard] = useState<Board>(game.mode === "daily" ? "today" : "all");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const routeId = game.route.id;
  const mine = game.board.state === "ok" && game.board.routeId === routeId ? game.board.rank : null;

  useEffect(() => {
    const ctl = new AbortController();
    setLoad({ state: "loading" });
    fetchBoard(routeId, board, ctl.signal).then(
      (rows) => setLoad({ state: "ok", rows }),
      () => {
        if (!ctl.signal.aborted) setLoad({ state: "error" });
      },
    );
    return () => ctl.abort();
  }, [routeId, board, mine]);

  const rows = load.state === "ok" ? load.rows.slice(0, compact ? 5 : 10) : [];

  return (
    <section className="rd-board" aria-labelledby="rd-board-title">
      <header className="rd-board-head">
        <h2 id="rd-board-title" className="rd-label">
          <Trophy aria-hidden="true" />
          {t("board.title")} · {game.route.name}
        </h2>
        <div className="rd-seg rd-seg-sm" role="radiogroup" aria-label={t("board.title")}>
          {(["today", "all"] as const).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={board === b} className={board === b ? "is-on" : ""} onClick={() => setBoard(b)}>
              {t(b === "today" ? "board.today" : "board.all")}
            </button>
          ))}
        </div>
      </header>

      {load.state === "loading" && <p className="rd-dim">{t("board.loading")}</p>}
      {load.state === "error" && <p className="rd-dim">{t("board.error")}</p>}
      {load.state === "ok" && rows.length === 0 && <p className="rd-dim">{t("board.empty")}</p>}
      {rows.length > 0 && (
        <ol className="rd-board-list">
          {rows.map((r) => (
            <li key={r.rank} className={r.rank === mine && board === "all" ? "is-you" : ""}>
              <span className="rd-board-rank">{r.rank}</span>
              <span className="rd-board-avatar" aria-hidden="true">
                {(r.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="rd-board-name">{r.rank === mine && board === "all" ? t("board.you") : (r.name ?? t("board.anon"))}</span>
              <span className="rd-board-time">{formatTime(r.timeS)}</span>
            </li>
          ))}
        </ol>
      )}

      {!compact && (
        <>
          <label className="rd-board-anon">
            <input type="checkbox" checked={game.anon} onChange={(e) => game.setAnon(e.target.checked)} />
            {t("board.anonToggle")}
          </label>
          <p className="rd-dim rd-board-rule">{t("board.rule")}</p>
        </>
      )}
    </section>
  );
}
