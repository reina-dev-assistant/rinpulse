import { useTranslation } from "react-i18next";
import { Image as ImageIcon, Maximize, Magnet, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import { FIELDS } from "@/model/fields";
import { simValue } from "@/render/values";
import { cn } from "@/ui/utils";
import { useEditor } from "./store";
import { SliderField } from "./fields";

const pad = (n: number) => String(n).padStart(2, "0");

export function SimPanel() {
  const { t } = useTranslation("editor");
  const sim = useEditor((s) => s.sim);
  const setSim = useEditor((s) => s.setSim);
  const elements = useEditor((s) => s.project.elements);
  // One slider per number field in the registry; a field kept only for old projects (calories) shows when the project uses it.
  const fields = FIELDS.filter((f) => f.sim && (!f.legacy || elements.some((el) => el.type === "widget" && el.valueType === f.id)));

  const d = new Date(sim.timeMs);
  const minutesOfDay = d.getHours() * 60 + d.getMinutes();

  const setClock = (minutes: number, seconds: number) => {
    const next = new Date(sim.timeMs);
    next.setHours(Math.floor(minutes / 60), minutes % 60, seconds, 0);
    setSim({ timeMs: next.getTime(), live: false });
  };

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 p-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="sim-panel">
      <div className="sm:col-span-2 xl:col-span-3 flex items-center justify-between gap-3 pb-1">
        <div>
          <h2 className="text-base font-bold tracking-tight">{t("sim.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("sim.note")}</p>
        </div>
        <button
          type="button"
          aria-pressed={sim.live}
          onClick={() => setSim({ live: !sim.live })}
          className={cn(
            "pressable flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            sim.live ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)]",
          )}
        >
          {sim.live ? <Pause className="size-4" /> : <Play className="size-4" />}
          {sim.live ? t("sim.running") : t("sim.run")}
        </button>
      </div>
      <SliderField
        label={t("sim.timeOfDay")}
        value={minutesOfDay}
        min={0}
        max={1439}
        format={(v) => `${pad(Math.floor(v / 60))}:${pad(v % 60)}`}
        onChange={(v) => setClock(v, d.getSeconds())}
      />
      <SliderField label={t("sim.seconds")} value={d.getSeconds()} min={0} max={59} format={(v) => pad(v)} onChange={(v) => setClock(minutesOfDay, v)} />
      <SliderField label={t("sim.stepGoal")} value={sim.stepGoal} min={2000} max={30000} step={500} color="var(--steps)" onChange={(stepGoal) => setSim({ stepGoal })} />
      {fields.map((f) => (
        <SliderField
          key={f.id}
          label={f.label}
          value={simValue(sim, f.id)}
          min={f.sim!.min}
          max={f.sim!.max}
          step={f.sim!.step}
          unit={f.sim!.unit}
          color={f.color}
          onChange={(v) => setSim({ values: { ...sim.values, [f.id]: v } })}
        />
      ))}
    </div>
  );
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function StageControls({ currentZoom }: { currentZoom: number }) {
  const { t } = useTranslation("editor");
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const snapping = useEditor((s) => s.snapping);
  const setSnapping = useEditor((s) => s.setSnapping);
  const photoPreview = useEditor((s) => s.photoPreview);
  const setPhotoPreview = useEditor((s) => s.setPhotoPreview);

  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > currentZoom + 0.01) : [...ZOOMS].reverse().find((z) => z < currentZoom - 0.01);
    if (next) setZoom(next);
  };
  const btn =
    "grid size-9 place-items-center rounded-full text-stage-foreground/80 transition-colors duration-150 hover:bg-white/10 hover:text-stage-foreground focus-visible:ring-[3px] focus-visible:ring-white/40 focus-visible:outline-none";

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 rounded-full bg-black/45 p-1 backdrop-blur-md">
      <button type="button" className={btn} aria-label={t("controls.zoomOut")} title={t("controls.zoomOutTitle")} onClick={() => step(-1)}>
        <ZoomOut className="size-4" />
      </button>
      <span className="w-12 text-center text-xs font-semibold text-stage-foreground tabular-nums" data-testid="zoom-label">
        {Math.round(currentZoom * 100)}%
      </span>
      <button type="button" className={btn} aria-label={t("controls.zoomIn")} title={t("controls.zoomInTitle")} onClick={() => step(1)}>
        <ZoomIn className="size-4" />
      </button>
      <button
        type="button"
        className={cn(btn, zoom === "fit" && "bg-white/15 text-stage-foreground")}
        aria-label={t("controls.fit")}
        aria-pressed={zoom === "fit"}
        title={t("controls.fitTitle")}
        onClick={() => setZoom("fit")}
      >
        <Maximize className="size-4" />
      </button>
      <span className="mx-0.5 h-5 w-px bg-white/15" />
      <button
        type="button"
        className={cn(btn, snapping && "bg-white/15 text-stage-foreground")}
        aria-label={t("controls.snap")}
        aria-pressed={snapping}
        title={t("controls.snapTitle")}
        onClick={() => setSnapping(!snapping)}
      >
        <Magnet className="size-4" />
      </button>
      <button
        type="button"
        className={cn(btn, photoPreview && "bg-white/15 text-stage-foreground")}
        aria-label={t("controls.photo")}
        aria-pressed={photoPreview}
        title={t("controls.photoTitle")}
        data-testid="photo-preview-toggle"
        onClick={() => setPhotoPreview(!photoPreview)}
      >
        <ImageIcon className="size-4" />
      </button>
    </div>
  );
}
