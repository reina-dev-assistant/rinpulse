import { Camera, ChevronDown, ChevronUp, Flag, Maximize, Pause, Play, Square, Volume2, VolumeX, Wind } from "lucide-react";

import { GEAR_COUNT } from "../../../../src/features/ride/physics.ts";
import type { Game, NearbyRider, Toast } from "../game.ts";
import { ZONE_COLORS, formatGrade, formatKm, formatTime, formatTimeTenths } from "../format.ts";
import { useT, type TKey, type TFn } from "../i18n.ts";
import type { IntervalSnapshot } from "../modes.ts";
import { Profile } from "./Profile.tsx";
import { useGame } from "./hooks.ts";

/** Gap to the player as Zwift shows it: "+12s" / "−3s", minutes from one up. */
function formatGap(gapS: number): string {
  const sign = gapS > 0.5 ? "+" : gapS < -0.5 ? "\u2212" : "";
  const abs = Math.abs(gapS);
  return `${sign}${abs < 60 ? `${Math.round(abs)}s` : formatTime(abs)}`;
}

/** The riders around the player, furthest ahead on top: colour, name, watts per kilo and the gap in seconds. */
function Nearby({ rows, t }: { rows: NearbyRider[]; t: TFn }) {
  return (
    <ol className="rd-nearby" aria-label={t("hud.nearby")}>
      {rows.map((r) => (
        <li key={r.key} className={`rd-nearby-row is-${r.kind}`}>
          <i className="rd-nearby-kit" style={{ background: `#${r.jersey.toString(16).padStart(6, "0")}` }} aria-hidden="true" />
          <span className="rd-nearby-name">
            {r.kind === "you" ? t("hud.you") : r.kind === "ghost" ? t("hud.ghost") : r.name}
            {r.kind === "bot" && <small className="rd-nearby-bot">BOT</small>}
          </span>
          <span className="rd-nearby-wkg">{r.wkg === null ? "" : `${r.wkg.toFixed(1)}`}</span>
          <span className="rd-nearby-gap">{r.kind === "you" ? "" : formatGap(r.gapS)}</span>
        </li>
      ))}
    </ol>
  );
}

function gradeColor(grade: number): string {
  if (grade < -1.5) return "#7fb4de";
  if (grade < 2.5) return "#ece8dc";
  if (grade < 5.5) return "#e8c35a";
  if (grade < 8.5) return "#ee9448";
  return "#e5604d";
}

function GradeGlyph({ grade }: { grade: number }) {
  const angle = -Math.atan(grade / 100) * (180 / Math.PI) * 2.2;
  return (
    <svg className="rd-grade-glyph" viewBox="0 0 48 24" aria-hidden="true">
      <g transform={`rotate(${angle.toFixed(1)} 24 12)`}>
        <rect x="2" y="10" width="44" height="4" rx="2" fill="currentColor" />
        <path d="M34 4l10 8-10 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

const GAUGE_MIN = 40;
const GAUGE_MAX = 130;
const gaugePct = (rpm: number) => Math.min(100, Math.max(0, ((rpm - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100));

/** Interval block, countdown and a cadence gauge with the target band. */
function IntervalPanel({ snap, cad, t }: { snap: IntervalSnapshot; cad: number | null; t: TFn }) {
  const { block } = snap;
  const status = snap.position === 0 ? "in" : snap.position === -1 ? "below" : snap.position === 1 ? "above" : "none";
  const label =
    status === "in" ? t("hud.inBand") : status === "below" ? t("hud.below") : status === "above" ? t("hud.above") : t("hud.target", { lo: block.cadLo, hi: block.cadHi });
  return (
    <div className={`rd-interval rd-interval-${block.kind}`} data-status={status}>
      <div className="rd-interval-head">
        <span className="rd-interval-name">{t(`block.${block.kind}` as TKey)}</span>
        <span className="rd-dim">{t("hud.block", { n: snap.index + 1, count: snap.count })}</span>
      </div>
      <span className="rd-interval-time">{formatTime(snap.remainingS)}</span>
      <div
        className="rd-gauge"
        role="meter"
        aria-label={t("hud.target", { lo: block.cadLo, hi: block.cadHi })}
        aria-valuemin={GAUGE_MIN}
        aria-valuemax={GAUGE_MAX}
        aria-valuenow={cad === null ? undefined : Math.round(cad)}
      >
        <span className="rd-gauge-band" style={{ left: `${gaugePct(block.cadLo)}%`, width: `${gaugePct(block.cadHi) - gaugePct(block.cadLo)}%` }} />
        {cad !== null && <span className="rd-gauge-mark" style={{ left: `${gaugePct(cad)}%` }} />}
      </div>
      <div className="rd-interval-foot">
        <b>{label}</b>
        <span className="rd-dim">{t("hud.compliance", { pct: Math.round(snap.compliance * 100) })}</span>
      </div>
      {snap.next && (
        <span className="rd-dim rd-interval-next">
          {t("hud.next", { name: t(`block.${snap.next.kind}` as TKey) })} · {snap.next.cadLo}–{snap.next.cadHi} rpm
        </span>
      )}
    </div>
  );
}

function toastText(toast: Toast, t: TFn): { title: string; detail: string; tone: "sprint" | "kom" | "lap"; pb: boolean } {
  if (toast.kind === "lap") {
    return { title: t("hud.lapDone", { n: toast.index, time: formatTime(toast.sec) }), detail: "", tone: "lap", pb: false };
  }
  if (toast.kind === "block") {
    return {
      title: `${t(`block.${toast.block.kind}` as TKey)} · ${formatTime(toast.block.durS)}`,
      detail: t("hud.target", { lo: toast.block.cadLo, hi: toast.block.cadHi }),
      tone: toast.block.kind === "hard" || toast.block.kind === "sprint" ? "kom" : "lap",
      pb: false,
    };
  }
  const name = t(`segment.${toast.segmentId}` as TKey);
  const kind = t(toast.segKind === "kom" ? "segment.kom" : "segment.sprint");
  if (toast.kind === "segment-start") {
    return {
      title: `${kind}: ${name}`,
      detail: toast.bestS !== null ? t("segment.best", { time: formatTimeTenths(toast.bestS) }) : "",
      tone: toast.segKind,
      pb: false,
    };
  }
  return {
    title: `${kind}: ${name}`,
    detail: `${formatTimeTenths(toast.timeS)}${toast.pb ? `  ${t("segment.pb")}` : ""}`,
    tone: toast.segKind,
    pb: toast.pb,
  };
}

export function Hud({ game }: { game: Game }) {
  useGame(game);
  const { t } = useT();
  const hud = game.hud;
  const phase = hud.phase;
  const riding = phase === "riding";
  const paused = phase === "paused";
  const countdown = phase === "countdown";
  const demo = game.demo;
  const zoneColor = hud.hr === null ? "var(--rd-muted)" : ZONE_COLORS[hud.hrZone - 1];
  const toast = game.toast;
  const toastView = toast ? toastText(toast, t) : null;
  const active = hud.segment;
  const gap = hud.ghostGapM;
  const effort = hud.hr === null ? 0 : Math.min(1, Math.max(0, (hud.hrZone - 3) / 2));
  const source = game.source?.kind === "room" ? t("hud.sourceRoom") : game.source?.kind === "ble" ? t("hud.sourceBle") : t("hud.sourceDemo");

  return (
    <div className="rd-hud" data-phase={phase}>
      <div className="rd-vignette" style={{ opacity: effort * 0.55 }} aria-hidden="true" />

      <div className="rd-top-left">
        <span className="rd-brand">
          <img src="/brand/logo-mark.svg" alt="" width={16} height={16} />
          JoyoFit
        </span>
        <span className="rd-label">
          {game.route.name} <span className="rd-dim">{source}</span>
        </span>
        <span className="rd-time">{formatTime(hud.timeS)}</span>
        <span className="rd-row">
          <span className="rd-pair-stat">
            <small>{t("hud.distance")}</small>
            <b>{formatKm(hud.distM)}</b> km
          </span>
          <span className="rd-pair-stat">
            <small>{t("hud.elevation")}</small>
            <b>{Math.round(hud.elevGainM)}</b> m
          </span>
        </span>
        <span className="rd-dim rd-remaining">{t("hud.remaining", { km: formatKm(hud.remainingM, 1) })}</span>
      </div>

      <div className="rd-top-center" aria-live="polite">
        {toastView && toast && (
          <div key={toast.id} className={`rd-toast rd-toast-${toastView.tone} ${toastView.pb ? "is-pb" : ""}`}>
            <b>{toastView.title}</b>
            {toastView.detail && <span>{toastView.detail}</span>}
          </div>
        )}
        {hud.interval && (riding || paused) && <IntervalPanel snap={hud.interval} cad={hud.cad} t={t} />}
        {hud.daily && (riding || paused) && (
          <div className={`rd-ghost-gap ${hud.daily.gapS <= 0 ? "is-ahead" : "is-behind"}`}>
            {t("hud.dailyTarget", { time: formatTime(hud.daily.targetS) })} ·{" "}
            {t(hud.daily.gapS <= 0 ? "hud.dailyAhead" : "hud.dailyBehind", { time: formatTime(Math.abs(hud.daily.gapS)) })}
          </div>
        )}
        {active && riding && (
          <div className={`rd-seg-live rd-seg-live-${active.kind}`}>
            <span>{t(`segment.${active.id}` as TKey)}</span>
            <b>{formatTimeTenths(active.elapsedS)}</b>
            {active.bestS !== null && <small>{t("segment.best", { time: formatTimeTenths(active.bestS) })}</small>}
          </div>
        )}
        {gap !== null && (riding || paused) && (
          <div className={`rd-ghost-gap ${gap >= 0 ? "is-ahead" : "is-behind"}`}>
            {t(gap >= 0 ? "hud.ghostAhead" : "hud.ghostBehind", { m: Math.abs(Math.round(gap)) })}
          </div>
        )}
        {hud.drafting && (
          <div className="rd-draft">
            <Wind aria-hidden="true" />
            {t("hud.drafting")}
          </div>
        )}
        {!hud.signal && riding && <div className="rd-nosignal">{t("hud.noSignal")}</div>}
      </div>

      <div className="rd-top-right">
        {demo && (
          <label className="rd-demo">
            <span>{t("hud.demoCadence")}</span>
            <input
              type="range"
              min={0}
              max={120}
              value={demo.manualCad}
              disabled={demo.auto}
              onChange={(e) => {
                demo.manualCad = Number(e.target.value);
                game.refresh();
              }}
            />
            <span className="rd-demo-auto">
              <input
                type="checkbox"
                checked={demo.auto}
                onChange={(e) => {
                  demo.auto = e.target.checked;
                  game.refresh();
                }}
              />
              {t("hud.demoAuto")}
            </span>
          </label>
        )}
        <div className="rd-tools">
          <button type="button" className="rd-tool" onClick={() => game.cycleCamera()} title={`${t("hud.camera")} (C)`}>
            <Camera aria-hidden="true" />
            <span>{t(`hud.camera.${game.cameraMode}` as TKey)}</span>
          </button>
          <button type="button" className="rd-tool" onClick={() => game.lap()} disabled={!riding} title={`${t("hud.lap")} (L)`}>
            <Flag aria-hidden="true" />
            <span>{t("hud.lap")}</span>
            {hud.lapCount > 0 && <span className="rd-tool-count">{hud.lapCount}</span>}
          </button>
          <button type="button" className="rd-tool" onClick={() => game.togglePause()} disabled={!riding && !paused} title={`${riding ? t("hud.pause") : t("hud.resume")} (Space)`}>
            {riding ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            <span>{riding ? t("hud.pause") : t("hud.resume")}</span>
          </button>
          <button
            type="button"
            className="rd-tool"
            onClick={() => game.toggleMute()}
            title={`${game.audio.muted ? t("hud.soundOn") : t("hud.soundOff")} (M)`}
            aria-label={game.audio.muted ? t("hud.soundOn") : t("hud.soundOff")}
            aria-pressed={game.audio.muted}
          >
            {game.audio.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="rd-tool"
            onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.())}
            title={`${t("hud.fullscreen")} (F)`}
            aria-label={t("hud.fullscreen")}
          >
            <Maximize aria-hidden="true" />
          </button>
        </div>
        {(riding || paused) && hud.nearby.length > 1 && <Nearby rows={hud.nearby} t={t} />}
      </div>

      <div className="rd-bottom">
        <div className="rd-cluster rd-cluster-left">
          <div className="rd-speed">
            <span className="rd-label">{t("hud.speed")}</span>
            <span className="rd-speed-num">{Math.round(hud.speedKmh)}</span>
            <span className="rd-unit">{t("hud.speedUnit")}</span>
          </div>
          <div className="rd-vitals">
            <div className="rd-metric" style={{ color: zoneColor }}>
              <span className="rd-label">{t("hud.hr")}</span>
              <span className="rd-metric-num">{hud.hr ?? "\u2013"}</span>
              <span className="rd-unit">{hud.hr === null ? "bpm" : `bpm \u00b7 ${t("hud.zone", { zone: hud.hrZone })}`}</span>
            </div>
            <div className="rd-metric">
              <span className="rd-label">{t("hud.cadence")}</span>
              <span className="rd-metric-num">{hud.cad === null ? "\u2013" : Math.round(hud.cad)}</span>
              <span className="rd-unit">rpm</span>
            </div>
          </div>
        </div>

        <div className="rd-mini">
          <Profile
            route={game.route}
            positionM={hud.positionM}
            ghostPositionM={hud.ghostPositionM}
            otherPositionsM={hud.botPositionsM}
            segments
            label={t("hud.profile")}
            className="rd-mini-prof"
          />
        </div>

        <div className="rd-cluster rd-cluster-right">
          <div className="rd-metric">
            <span className="rd-label">
              {t("hud.power")} <span className={`rd-tag ${hud.powerMeasured ? "" : "is-est"}`}>{hud.powerMeasured ? t("hud.powerMeasured") : t("hud.powerEst")}</span>
            </span>
            <span className="rd-metric-num">{Math.round(hud.powerW)}</span>
            <span className="rd-unit">W · {hud.wkg.toFixed(1)} W/kg</span>
          </div>
          <div className="rd-metric rd-grade" style={{ color: gradeColor(hud.grade) }}>
            <span className="rd-label">{t("hud.grade")}</span>
            <span className="rd-metric-num">
              <GradeGlyph grade={hud.grade} />
              {formatGrade(hud.grade)}
            </span>
            <span className="rd-unit">%</span>
          </div>
          <div className="rd-gear">
            <span className="rd-label">{t("hud.gear")}</span>
            <div className="rd-gear-row">
              <span className="rd-gear-label">{hud.gearLabel.replace("x", "\u00d7")}</span>
              <span className="rd-gear-btns">
                <button type="button" onClick={() => game.shift(1)} disabled={hud.gear >= GEAR_COUNT - 1} aria-label={t("hud.gearUp")} title={`${t("hud.gearUp")} (\u2191)`}>
                  <ChevronUp aria-hidden="true" />
                </button>
                <button type="button" onClick={() => game.shift(-1)} disabled={hud.gear <= 0} aria-label={t("hud.gearDown")} title={`${t("hud.gearDown")} (\u2193)`}>
                  <ChevronDown aria-hidden="true" />
                </button>
              </span>
            </div>
            <span className="rd-unit">
              {hud.gear + 1}/{GEAR_COUNT}
            </span>
          </div>
        </div>
      </div>

      {countdown && (
        <div className="rd-countdown" aria-live="assertive">
          <span key={Math.ceil(hud.countdownS)} className="rd-count-num">
            {Math.ceil(hud.countdownS)}
          </span>
        </div>
      )}

      {paused && (
        <div className="rd-overlay" role="dialog" aria-modal="true" aria-labelledby="rd-pause-title">
          <div className="rd-card rd-pause-card">
            <h2 id="rd-pause-title" className="rd-title rd-title-sm">
              {t("pause.title")}
            </h2>
            <p className="rd-muted">{t("pause.keys")}</p>
            <div className="rd-actions">
              <button type="button" className="rd-btn rd-btn-primary rd-btn-lg" onClick={() => game.togglePause()} autoFocus>
                <Play aria-hidden="true" />
                {t("hud.resume")}
              </button>
              <button type="button" className="rd-btn rd-btn-quiet" onClick={() => game.finishRide()}>
                <Square aria-hidden="true" />
                {t("pause.stop")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
