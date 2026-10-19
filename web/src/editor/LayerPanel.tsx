import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useState, useSyncExternalStore } from "react";
import {
  BatteryFull,
  CalendarDays,
  CircleDashed,
  Clock,
  Eye,
  EyeOff,
  Flame,
  Footprints,
  Heart,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Mountain,
  Paintbrush,
  Plus,
  Thermometer,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { VALUE_TYPE } from "@joyofit/hwt";
import { newHand, newRing, newWidget, newDate, newImage, newTime } from "@/model/defaults";
import { assetsVersion, subscribeAssets } from "@/model/assets";
import { fieldDef } from "@/model/fields";
import type { Element, IconName } from "@/model/types";
import { elementSupport } from "@/export/support";
import { cn } from "@/ui/utils";
import { FieldBrowser } from "./FieldBrowser";
import { useEditor } from "./store";

interface Look {
  icon: LucideIcon;
  /** Tailwind classes for the chip: background tint and icon color. */
  chip: string;
}

const NEUTRAL = "bg-muted text-muted-foreground";
const ICONS: Record<IconName, LucideIcon> = {
  steps: Footprints,
  heart: Heart,
  battery: BatteryFull,
  flame: Flame,
  mountain: Mountain,
  thermometer: Thermometer,
};

/** Chip colors by metric. The metrics that have a theme token use it; the others stay neutral. */
function chipOf(id: number): string {
  switch (fieldDef(id)?.icon) {
    case "steps":
      return "bg-steps-soft text-steps-ink";
    case "heart":
      return "bg-heart-soft text-heart-ink";
    case "battery":
      return "bg-battery-soft text-battery-ink";
    case "flame":
      return "bg-calories-soft text-calories-ink";
    default:
      return NEUTRAL;
  }
}

function lookOf(el: Element): Look {
  switch (el.type) {
    case "background":
      return { icon: Paintbrush, chip: NEUTRAL };
    case "time":
      return { icon: Clock, chip: NEUTRAL };
    case "date":
      return { icon: CalendarDays, chip: NEUTRAL };
    case "hand":
      return { icon: Timer, chip: NEUTRAL };
    case "image":
      return { icon: ImageIcon, chip: NEUTRAL };
    case "widget":
      return { icon: ICONS[fieldDef(el.valueType)?.icon ?? "steps"], chip: chipOf(el.valueType) };
    case "ring":
      return { icon: CircleDashed, chip: chipOf(el.valueType) };
    case "iconset":
      return { icon: ICONS[fieldDef(el.valueType)?.icon ?? "battery"], chip: chipOf(el.valueType) };
  }
}

interface AddAction {
  /** Full name for assistive tech; `short` is shown, because the group heading already gives context. */
  label: string;
  short: string;
  icon: LucideIcon;
  chip: string;
  make: () => Element[];
}

function addGroups(t: TFunction<"editor">): Array<{ title: string; actions: AddAction[] }> {
  return [
    {
      title: t("layers.groups.timeDate"),
      actions: [
        { label: t("layers.add.time"), short: t("layers.add.timeShort"), icon: Clock, chip: NEUTRAL, make: () => [newTime()] },
        { label: t("layers.add.date"), short: t("layers.add.dateShort"), icon: CalendarDays, chip: NEUTRAL, make: () => [newDate()] },
      ],
    },
    {
      title: t("layers.groups.hands"),
      actions: [
        { label: t("layers.add.hour"), short: t("layers.add.hourShort"), icon: Timer, chip: NEUTRAL, make: () => [newHand("hour")] },
        { label: t("layers.add.minute"), short: t("layers.add.minuteShort"), icon: Timer, chip: NEUTRAL, make: () => [newHand("minute")] },
        { label: t("layers.add.second"), short: t("layers.add.secondShort"), icon: Timer, chip: NEUTRAL, make: () => [newHand("second")] },
      ],
    },
    {
      title: t("layers.groups.data"),
      actions: [VALUE_TYPE.steps, VALUE_TYPE.heartRate, VALUE_TYPE.power].map((id) => {
        const def = fieldDef(id)!;
        return { label: def.label, short: def.label, icon: ICONS[def.icon], chip: chipOf(id), make: () => [newWidget(id)] };
      }),
    },
    {
      title: t("layers.groups.rings"),
      actions: [
        { label: t("layers.add.stepsRing"), short: t("layers.add.stepsRing"), icon: CircleDashed, chip: chipOf(VALUE_TYPE.stepsRatio), make: () => [newRing(VALUE_TYPE.stepsRatio)] },
        { label: t("layers.add.batteryRing"), short: t("layers.add.batteryRing"), icon: CircleDashed, chip: chipOf(VALUE_TYPE.powerRatio), make: () => [newRing(VALUE_TYPE.powerRatio, { size: 120, thickness: 10, x: 24, y: 24 })] },
        { label: t("layers.add.image"), short: t("layers.add.imageShort"), icon: ImageIcon, chip: NEUTRAL, make: () => [newImage(null, 120, 120)] },
      ],
    },
  ];
}

export function AddElements() {
  const { t } = useTranslation("editor");
  const groups = addGroups(t);
  const addCustom = useEditor((s) => s.addCustom);
  return (
    <div className="space-y-3" data-testid="add-elements">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-1 text-xs font-semibold text-muted-foreground">{group.title}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {group.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                aria-label={a.label}
                title={a.label}
                onClick={() => a.make().forEach(addCustom)}
                className="pressable flex min-h-10 items-center gap-2 rounded-xl bg-muted px-2.5 text-left text-[0.8125rem] font-semibold transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-lg", a.chip)}>
                  <a.icon className="size-3.5" strokeWidth={2} />
                </span>
                <span className="truncate">{a.short}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IconToggle({ on, onLabel, offLabel, onIcon: On, offIcon: Off, onClick, active }: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onIcon: LucideIcon;
  offIcon: LucideIcon;
  onClick: () => void;
  /** Highlight the "off" state: a hidden or locked layer is a state worth seeing. */
  active: boolean;
}) {
  const Icon = on ? On : Off;
  return (
    <button
      type="button"
      aria-label={on ? onLabel : offLabel}
      title={on ? onLabel : offLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-150 hover:bg-foreground/8 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        active ? "text-foreground" : "text-muted-foreground/70",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function LayerPanel() {
  const { t } = useTranslation("editor");
  const elements = useEditor((s) => s.project.elements);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const updateElement = useEditor((s) => s.updateElement);
  const reorder = useEditor((s) => s.reorder);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"elements" | "fields">("elements");
  // Whether an image layer is exportable depends on its bitmap having loaded.
  useSyncExternalStore(subscribeAssets, assetsVersion);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Top of the list is the top of the stack.
  const rows = [...elements].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-base font-bold tracking-tight">{t("layers.title")}</h2>
        <button
          type="button"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
          className="pressable flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[0.8125rem] font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Plus className={cn("size-4 transition-transform duration-200", adding && "rotate-45")} />
          {t("layers.addButton")}
        </button>
      </div>

      {adding && (
        <div className={cn("panel-scroll mx-3 mb-2 shrink-0 overflow-y-auto rounded-2xl bg-card p-3 ring-1 ring-border", tab === "fields" ? "max-h-[75%]" : "max-h-[60%]")}>
          <div role="tablist" aria-label={t("layers.addTabs")} className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
            {(["elements", "fields"] as const).map((tabName) => (
              <button
                key={tabName}
                type="button"
                role="tab"
                aria-selected={tab === tabName}
                data-testid={`add-tab-${tabName}`}
                onClick={() => setTab(tabName)}
                className={cn(
                  "h-7 rounded-full text-xs font-semibold transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                  tab === tabName ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {tabName === "elements" ? t("layers.tabElements") : t("layers.tabFields")}
              </button>
            ))}
          </div>
          {tab === "elements" ? <AddElements /> : <FieldBrowser />}
        </div>
      )}

      <ul className="panel-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3" data-testid="layers">
        {rows.map((el) => {
          const look = lookOf(el);
          const index = elements.indexOf(el);
          const selected = el.id === selectedId;
          const level = elementSupport(el).level;
          return (
            <li
              key={el.id}
              draggable={el.type !== "background"}
              onDragStart={() => setDragId(el.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                if (dragId && el.type !== "background") {
                  e.preventDefault();
                  setOverId(el.id);
                }
              }}
              onDrop={() => {
                if (dragId && dragId !== el.id) reorder(dragId, index);
                setDragId(null);
                setOverId(null);
              }}
              className={cn("rounded-2xl transition-shadow duration-150", overId === el.id && dragId !== el.id && "ring-2 ring-primary/60")}
            >
              <div
                role="button"
                tabIndex={0}
                data-testid={`layer-${el.type}`}
                aria-pressed={selected}
                onClick={() => select(el.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(el.id);
                  }
                }}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                  selected ? "bg-primary/10" : "hover:bg-foreground/5",
                  !el.visible && "opacity-55",
                )}
              >
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", look.chip)}>
                  <look.icon className="size-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{el.name}</span>
                  {level !== "verified" && (
                    <span className="block text-[0.6875rem] font-semibold text-warning">
                      {level === "preview-only" ? t("layers.previewOnly") : t("layers.unconfirmed")}
                    </span>
                  )}
                </span>
                <IconToggle
                  on={el.visible}
                  onLabel={t("layers.hide")}
                  offLabel={t("layers.show")}
                  onIcon={Eye}
                  offIcon={EyeOff}
                  active={!el.visible}
                  onClick={() => updateElement(el.id, { visible: !el.visible })}
                />
                <IconToggle
                  on={el.locked}
                  onLabel={t("layers.unlock")}
                  offLabel={t("layers.lock")}
                  onIcon={Lock}
                  offIcon={LockOpen}
                  active={el.locked}
                  onClick={() => updateElement(el.id, { locked: !el.locked })}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
