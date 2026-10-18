import { ArrowLeft, CalendarDays, Medal as MedalIcon, Play, Route as RouteIcon, Timer } from "lucide-react";

import { JERSEYS, type Game } from "../game.ts";
import { formatKm, formatTime } from "../format.ts";
import { useT, type TKey } from "../i18n.ts";
import { MODE_IDS, WORKOUTS, workoutDurationS, type ModeId } from "../modes.ts";
import { ROUTES, routeById } from "../routes.ts";
import { loadDailyBest, loadGhost } from "../storage.ts";
import { QUALITY_IDS, type QualityId } from "../theme.ts";
import { routeStats } from "../track.ts";
import { useGame } from "./hooks.ts";
import { Leaderboard } from "./Leaderboard.tsx";
import { Profile } from "./Profile.tsx";

interface Props {
  game: Game;
  quality: QualityId;
  onQuality: (q: QualityId) => void;
}

const MODE_ICONS: Record<ModeId, typeof RouteIcon> = { free: RouteIcon, interval: Timer, daily: CalendarDays };

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

export function RouteScreen({ game, quality, onQuality }: Props) {
  useGame(game);
  const { t } = useT();
  const daily = game.daily;
  const dailyRoute = routeById(daily.routeId);
  const dailyBest = loadDailyBest(daily.day);
  const isDaily = game.mode === "daily";

  return (
    <section className="rd-screen rd-routes" aria-labelledby="rd-routes-title">
      <header className="rd-routes-head">
        <button type="button" className="rd-btn rd-btn-quiet" onClick={() => game.backToPair()}>
          <ArrowLeft aria-hidden="true" />
          {t("routes.back")}
        </button>
        <h1 id="rd-routes-title" className="rd-title rd-title-sm">
          {t("routes.title")}
        </h1>
        <div className="rd-seg" role="radiogroup" aria-label={t("routes.quality")}>
          {QUALITY_IDS.map((q) => (
            <button
              key={q}
              type="button"
              role="radio"
              aria-checked={quality === q}
              className={quality === q ? "is-on" : ""}
              onClick={() => onQuality(q)}
            >
              {t(`routes.quality.${q}` as TKey)}
            </button>
          ))}
        </div>
      </header>

      <div className="rd-modes" role="radiogroup" aria-label={t("mode.title")}>
        {MODE_IDS.map((m) => {
          const Icon = MODE_ICONS[m];
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={game.mode === m}
              className={`rd-mode ${game.mode === m ? "is-on" : ""}`}
              onClick={() => game.selectMode(m)}
            >
              <Icon aria-hidden="true" />
              <span className="rd-mode-name">{t(`mode.${m}` as TKey)}</span>
              <span className="rd-mode-hint">{t(`mode.${m}.hint` as TKey)}</span>
            </button>
          );
        })}
      </div>

      {game.mode === "interval" && (
        <div className="rd-seg rd-workouts" role="radiogroup" aria-label={t("mode.interval")}>
          {WORKOUTS.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={game.workoutId === w.id}
              className={game.workoutId === w.id ? "is-on" : ""}
              onClick={() => game.selectWorkout(w.id)}
            >
              {t(`workout.${w.id}` as TKey)}
              <small>{t("workout.minutes", { min: Math.round(workoutDurationS(w) / 60) })}</small>
            </button>
          ))}
        </div>
      )}

      {isDaily && (
        <div className="rd-daily">
          <MedalIcon aria-hidden="true" />
          <div>
            <b>{t("daily.today", { route: dailyRoute.name })}</b>
            <span className="rd-muted">
              {t("daily.target")} {formatTime(daily.targetS)}
              {dailyBest !== null ? ` · ${t("daily.best")} ${formatTime(dailyBest)}` : ""}
            </span>
            <span className="rd-dim">{t("medal.hint")}</span>
          </div>
        </div>
      )}

      <div className="rd-route-list" role="radiogroup" aria-label={t("routes.title")}>
        {ROUTES.map((route) => {
          const stats = routeStats(route);
          const best = loadGhost(route.id);
          const selected = game.route.id === route.id;
          const locked = isDaily && route.id !== daily.routeId;
          return (
            <button
              key={route.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked}
              className={`rd-route ${selected ? "is-on" : ""}`}
              onClick={() => game.selectRoute(route.id)}
              onDoubleClick={() => game.startRide()}
            >
              <span className="rd-route-top">
                <span className="rd-route-name">{route.name}</span>
                <span className="rd-route-km">{formatKm(route.lengthM, 1)} km</span>
              </span>
              <Profile route={route} segments label={`${t("hud.profile")}: ${route.name}`} className="rd-route-prof" />
              <span className="rd-route-blurb">{t(`route.${route.id}.blurb` as TKey)}</span>
              <span className="rd-route-stats">
                <span>
                  <small>{t("routes.climb")}</small>
                  {Math.round(stats.gainM)} m
                </span>
                <span>
                  <small>{t("routes.maxGrade")}</small>
                  {stats.maxGrade.toFixed(1)}%
                </span>
                <span>
                  <small>{t("routes.best")}</small>
                  {best ? formatTime(best.timeS) : t("routes.noBest")}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rd-routes-extra">
        <fieldset className="rd-jersey">
          <legend className="rd-label">{t("jersey.title")}</legend>
          {JERSEYS.map((c) => (
            <button
              key={c}
              type="button"
              className={`rd-swatch ${game.jersey === c ? "is-on" : ""}`}
              style={{ background: hex(c) }}
              aria-label={hex(c)}
              aria-pressed={game.jersey === c}
              onClick={() => game.setJersey(c)}
            />
          ))}
        </fieldset>
        <Leaderboard game={game} />
      </div>

      <footer className="rd-routes-foot">
        <button type="button" className="rd-btn rd-btn-primary rd-btn-lg" onClick={() => game.startRide()}>
          <Play aria-hidden="true" />
          {t("routes.start")} {game.route.name}
        </button>
      </footer>
    </section>
  );
}
