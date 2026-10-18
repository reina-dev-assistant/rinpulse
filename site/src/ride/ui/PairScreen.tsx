import { Bluetooth, Gamepad2, Languages, Smartphone } from "lucide-react";

import { joinLink } from "../../../../src/features/ride/protocol.ts";
import { bleSupported } from "../sources/ble.ts";
import type { Game } from "../game.ts";
import { formatTime } from "../format.ts";
import { getLang, setLang, useT } from "../i18n.ts";
import { useGame, useNow } from "./hooks.ts";
import { Qr } from "./Qr.tsx";

function groupCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function PairScreen({ game }: { game: Game }) {
  useGame(game);
  const { t } = useT();
  const room = game.room;
  const info = room?.room ?? null;
  const state = room?.state ?? "idle";
  const now = useNow(info !== null);
  const remainingMs = info ? info.codeExpiresAt - now : 0;
  const codeExpired = info !== null && remainingMs <= 0;
  const phoneIn = state === "live";
  const bleOn = game.ble;

  let status: string;
  if (state === "error") status = room?.detail === "expired" ? t("pair.expiredRoom") : t("pair.error");
  else if (state === "lost") status = t("pair.lost");
  else if (phoneIn) status = room?.phoneApp ? t("pair.connectedVia", { app: room.phoneApp }) : t("pair.connected");
  else if (!info) status = t("pair.connecting");
  else status = t("pair.waiting");

  const preview = game.preview;
  const canContinue = phoneIn || (bleOn !== null && bleOn.state === "live");

  return (
    <section className="rd-screen rd-pair" aria-labelledby="rd-pair-title">
      <header className="rd-pair-head">
        <p className="rd-brand">JoyoFit</p>
        <h1 id="rd-pair-title" className="rd-title">
          {t("app.name")}
        </h1>
        <p className="rd-lead">{t("app.tagline")}</p>
        <button type="button" className="rd-btn rd-btn-quiet rd-lang" onClick={() => setLang(getLang() === "id" ? "en" : "id")}>
          <Languages aria-hidden="true" />
          {t("lang.switch")}
        </button>
      </header>

      <div className="rd-pair-body">
        <div className="rd-card rd-pair-card">
          <h2 className="rd-h2">
            <Smartphone aria-hidden="true" />
            {t("pair.title")}
          </h2>
          <ol className="rd-steps">
            <li>{t("pair.step1")}</li>
            <li>{t("pair.step2")}</li>
          </ol>

          {info && !codeExpired && state !== "error" ? (
            <div className="rd-code-row">
              <Qr text={joinLink(info.code)} label={t("pair.qrAlt")} />
              <div className="rd-code-col">
                <span className="rd-label">{t("pair.code")}</span>
                <span className="rd-code" aria-label={info.code.split("").join(" ")}>
                  {groupCode(info.code)}
                </span>
                <span className="rd-muted">{t("pair.expiresIn", { time: formatTime(remainingMs / 1000) })}</span>
              </div>
            </div>
          ) : (
            <div className="rd-code-row rd-code-empty">
              {state === "error" || codeExpired ? (
                <>
                  <p>{codeExpired && state !== "error" ? t("pair.expired") : status}</p>
                  <button type="button" className="rd-btn rd-btn-primary" onClick={() => void game.renewRoom()}>
                    {codeExpired && state !== "error" ? t("pair.newCode") : t("pair.retry")}
                  </button>
                </>
              ) : (
                <p>{t("pair.connecting")}</p>
              )}
            </div>
          )}

          {state !== "error" && (
            <p className="rd-status" role="status">
              {(phoneIn || state === "waiting") && <span className={`rd-state-dot ${phoneIn ? "is-live" : ""}`} aria-hidden="true" />}
              {status}
            </p>
          )}
          {phoneIn && (
            <p className="rd-muted">
              {preview && (preview.cad !== undefined || preview.hr !== undefined)
                ? `${t("pair.preview")}: ${preview.hr !== undefined ? `${preview.hr} ${t("summary.unit.bpm")}` : ""}${
                    preview.hr !== undefined && preview.cad !== undefined ? ", " : ""
                  }${preview.cad !== undefined ? `${Math.round(preview.cad)} ${t("summary.unit.rpm")}` : ""}`
                : t("pair.noSensor")}
            </p>
          )}
        </div>

        <div className="rd-pair-side">
          <p className="rd-or">{t("pair.or")}</p>
          <button type="button" className="rd-option" onClick={() => game.startDemo()}>
            <Gamepad2 aria-hidden="true" />
            <span>
              <strong>{t("pair.demo")}</strong>
              <small>{t("pair.demoHint")}</small>
            </span>
          </button>
          {bleSupported() ? (
            <button type="button" className="rd-option" onClick={() => void game.addBle()}>
              <Bluetooth aria-hidden="true" />
              <span>
                <strong>{bleOn && bleOn.state === "live" ? t("pair.bleMore") : t("pair.ble")}</strong>
                <small>{bleOn?.detail ? t("pair.bleDevices", { names: bleOn.detail }) : t("pair.bleHint")}</small>
              </span>
            </button>
          ) : (
            <div className="rd-option rd-option-off">
              <Bluetooth aria-hidden="true" />
              <span>
                <strong>{t("pair.ble")}</strong>
                <small>{t("pair.bleUnsupported")}</small>
              </span>
            </div>
          )}
          {game.bleError && <p className="rd-error">{t("pair.bleError", { error: game.bleError })}</p>}
          <button type="button" className="rd-btn rd-btn-primary rd-next" disabled={!canContinue} onClick={() => game.toRoutes()}>
            {t("pair.next")}
          </button>
        </div>
      </div>
    </section>
  );
}
