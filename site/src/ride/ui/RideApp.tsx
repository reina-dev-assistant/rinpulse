import { useEffect, useRef, useState } from "react";

import { Engine } from "../engine.ts";
import { Game } from "../game.ts";
import { useT } from "../i18n.ts";
import { defaultQuality, loadSettings, saveSettings } from "../storage.ts";
import type { QualityId } from "../theme.ts";
import { Hud } from "./Hud.tsx";
import { PairScreen } from "./PairScreen.tsx";
import { RouteScreen } from "./RouteScreen.tsx";
import { Summary } from "./Summary.tsx";
import { useGame, usePrefersReducedMotion } from "./hooks.ts";

declare global {
  interface Window {
    /** Present with `?debug`: the live game and engine, for measuring and scripted checks. */
    __ride?: { game: Game; engine: Engine | null };
  }
}

function Scene({ game, quality, reducedMotion }: { game: Game; quality: QualityId; reducedMotion: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const { t } = useT();

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let engine: Engine;
    try {
      engine = new Engine(el, quality, reducedMotion);
    } catch {
      setFailed(true);
      return;
    }
    game.attachEngine(engine);
    engine.start();
    if (new URLSearchParams(window.location.search).has("debug")) window.__ride = { game, engine };
    return () => {
      game.attachEngine(null);
      engine.dispose();
    };
  }, [game, quality, reducedMotion]);

  return (
    <>
      <canvas ref={canvas} className="rd-canvas" aria-hidden="true" />
      {failed && (
        <p className="rd-webgl-error" role="alert">
          {t("error.webgl")}
        </p>
      )}
    </>
  );
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox";
}

export function RideApp() {
  const [game] = useState(() => new Game());
  const reducedMotion = usePrefersReducedMotion();
  const [quality, setQuality] = useState<QualityId>(() => loadSettings().quality ?? defaultQuality());
  useGame(game);

  useEffect(() => {
    game.startPhone();
    return () => game.dispose();
  }, [game]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (game.screen !== "ride" || isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      let handled = true;
      switch (e.key) {
        case "ArrowUp":
          game.shift(1);
          break;
        case "ArrowDown":
          game.shift(-1);
          break;
        case " ":
        case "Escape":
          if (!e.repeat) game.togglePause();
          break;
        case "l":
        case "L":
          game.lap();
          break;
        case "c":
        case "C":
          game.cycleCamera();
          break;
        case "f":
        case "F":
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    // A focused button would otherwise also "click" on Space keyup.
    const up = (e: KeyboardEvent) => {
      if (e.key === " " && game.screen === "ride" && !isEditable(e.target)) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [game]);

  const changeQuality = (q: QualityId) => {
    saveSettings({ quality: q });
    setQuality(q);
  };

  return (
    <div className="rd-root">
      <Scene key={quality} game={game} quality={quality} reducedMotion={reducedMotion} />
      {game.screen === "pair" && <PairScreen game={game} />}
      {game.screen === "routes" && <RouteScreen game={game} quality={quality} onQuality={changeQuality} />}
      {game.screen === "ride" && <Hud game={game} />}
      {game.screen === "summary" && <Summary game={game} />}
    </div>
  );
}
