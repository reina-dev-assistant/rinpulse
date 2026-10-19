import { VALUE_TYPE, WIDGET_DATA_TYPE } from "@joyofit/hwt";
import { i18n } from "@/i18n";
import type fieldsId from "@/i18n/locales/id/fields";
import type { IconName, Sim } from "./types";

type FieldLabelKey = keyof (typeof fieldsId)["label"];

/**
 * The data fields Studio can draw, keyed by the codec's `value_type` id (`packages/hwt` VALUE_TYPES). A widget, ring or
 * icon-set element only stores that id; everything else about the field lives here: label, icon, how many digits it
 * has and in which range, the sign glyph, the preview slider and the container slot (`data_type`) the export puts it in.
 *
 * What a field is worth (verified / unconfirmed / unknown) is not stored here. It always comes from the codec's own evidence
 * through `levelOfId` in `export/support.ts`, so the field browser and the export gate read one source.
 *
 * Not every codec id has an entry: ids that no element can draw (clock digits drawn by the Time and Date elements, hands,
 * weather icons without a known order) are listed in `HOSTED_BY` and `NO_ELEMENT` with the reason the browser shows.
 */

export interface NumberSpec {
  /** Most digits the watch shows (also the width reserved in the layout). */
  digits: number;
  min: number;
  max: number;
  /** Glyph written after the number as `res_sign`. */
  sign?: "degree";
}

export interface RatioSpec {
  /** The number field whose preview value drives the ring. */
  follows: number;
  /** Fraction 0..1 of the ring for the followed value. A scale the watch uses is not known for every ratio. */
  scale: (value: number, sim: Sim) => number;
}

export interface IconSetSpec {
  /** Images the watch expects (`VALUE_TYPES[].imageCount`). */
  count: number;
  follows: number;
  /** Index of the image shown for the followed value. */
  index: (value: number) => number;
}

export interface SimSpec {
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface FieldDef {
  id: number;
  label: string;
  icon: IconName;
  /** Accent for the icon and the preview slider. */
  color: string;
  /** Container `data_type` the export puts the element in. Absent when no sample identifies the slot. */
  slot?: number;
  number?: NumberSpec;
  ratio?: RatioSpec;
  iconSet?: IconSetSpec;
  /** Preview slider (number fields only; ratios and icon sets follow their number). */
  sim?: SimSpec;
  /** Kept so old projects still open; never offered by the browser. */
  legacy?: boolean;
}

/** Codec id 1 ("Activity text A"): the only id an old project's calories widget can map to. Unknown evidence, so preview only. */
export const LEGACY_CALORIES_ID = 1;

const ALTITUDE_SCALE_M = 8848;

const RAW_FIELDS: ReadonlyArray<Omit<FieldDef, "label"> & { labelKey: FieldLabelKey }> = [
  {
    id: VALUE_TYPE.steps,
    labelKey: "steps",
    icon: "steps",
    color: "#5FD3EE",
    slot: WIDGET_DATA_TYPE.steps,
    number: { digits: 5, min: 0, max: 99999 },
    sim: { default: 6842, min: 0, max: 30000, step: 50 },
  },
  {
    id: VALUE_TYPE.heartRate,
    labelKey: "heartRate",
    icon: "heart",
    color: "#FF8FA4",
    slot: WIDGET_DATA_TYPE.heartRate,
    number: { digits: 3, min: 0, max: 255 },
    sim: { default: 72, min: 40, max: 200, step: 1, unit: "bpm" },
  },
  {
    id: VALUE_TYPE.altitude,
    labelKey: "altitude",
    icon: "mountain",
    color: "#C3A6FF",
    slot: WIDGET_DATA_TYPE.altitude,
    number: { digits: 4, min: 0, max: 9999 },
    sim: { default: 548, min: 0, max: 4000, step: 10, unit: "m" },
  },
  {
    id: VALUE_TYPE.temperature,
    labelKey: "temperature",
    icon: "thermometer",
    color: "#FF9F5A",
    slot: WIDGET_DATA_TYPE.weather,
    number: { digits: 2, min: -99, max: 99, sign: "degree" },
    sim: { default: 24, min: -30, max: 50, step: 1, unit: "°" },
  },
  {
    id: VALUE_TYPE.temperatureMax,
    labelKey: "temperatureMax",
    icon: "thermometer",
    color: "#FF7A6B",
    slot: WIDGET_DATA_TYPE.weather,
    number: { digits: 2, min: -99, max: 99, sign: "degree" },
    sim: { default: 31, min: -30, max: 50, step: 1, unit: "°" },
  },
  {
    id: VALUE_TYPE.temperatureMin,
    labelKey: "temperatureMin",
    icon: "thermometer",
    color: "#6BB8FF",
    slot: WIDGET_DATA_TYPE.weather,
    number: { digits: 2, min: -99, max: 99, sign: "degree" },
    sim: { default: 19, min: -30, max: 50, step: 1, unit: "°" },
  },
  {
    id: VALUE_TYPE.power,
    labelKey: "battery",
    icon: "battery",
    color: "#6EE7A0",
    slot: WIDGET_DATA_TYPE.power,
    number: { digits: 3, min: 0, max: 100 },
    sim: { default: 78, min: 0, max: 100, step: 1, unit: "%" },
  },
  {
    id: LEGACY_CALORIES_ID,
    labelKey: "calories",
    icon: "flame",
    color: "#F5B35A",
    number: { digits: 4, min: 0, max: 9999 },
    sim: { default: 412, min: 0, max: 1500, step: 5, unit: "kcal" },
    legacy: true,
  },
  {
    id: VALUE_TYPE.stepsRatio,
    labelKey: "stepsGoal",
    icon: "steps",
    color: "#5FD3EE",
    slot: WIDGET_DATA_TYPE.steps,
    ratio: { follows: VALUE_TYPE.steps, scale: (v, sim) => v / Math.max(1, sim.stepGoal) },
  },
  {
    id: VALUE_TYPE.heartRateRatio,
    labelKey: "heartRate",
    icon: "heart",
    color: "#FF8FA4",
    slot: WIDGET_DATA_TYPE.heartRate,
    // Huawei's default for this ratio is 97 of 255 (about 38 %), the scale the FocusWGTru sample's ring shows.
    ratio: { follows: VALUE_TYPE.heartRate, scale: (v) => v / 255 },
  },
  {
    id: VALUE_TYPE.powerRatio,
    labelKey: "battery",
    icon: "battery",
    color: "#6EE7A0",
    slot: WIDGET_DATA_TYPE.power,
    ratio: { follows: VALUE_TYPE.power, scale: (v) => v / 100 },
  },
  {
    id: VALUE_TYPE.altitudeRatio,
    labelKey: "altitude",
    icon: "mountain",
    color: "#C3A6FF",
    slot: WIDGET_DATA_TYPE.altitude,
    // The range the watch maps to the full arc is not known; the preview uses 0 to Everest.
    ratio: { follows: VALUE_TYPE.altitude, scale: (v) => v / ALTITUDE_SCALE_M },
  },
  {
    id: VALUE_TYPE.powerEnum,
    labelKey: "batteryLevel",
    icon: "battery",
    color: "#6EE7A0",
    slot: WIDGET_DATA_TYPE.power,
    // 11 images: 0 to 100 percent in 10 percent steps (VALUE_TYPES note).
    iconSet: { count: 11, follows: VALUE_TYPE.power, index: (v) => Math.max(0, Math.min(10, Math.round(v / 10))) },
  },
];

/** Registry entries; `label` is looked up when read, so it follows the language switch. */
export const FIELDS: readonly FieldDef[] = RAW_FIELDS.map(({ labelKey, ...def }) => ({
  ...def,
  get label() {
    return i18n.t(`fields:label.${labelKey}`);
  },
}));

const BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

export function fieldDef(id: number): FieldDef | undefined {
  return BY_ID.get(id);
}

type ReasonKey = Exclude<keyof (typeof fieldsId)["reason"], "unknownId" | "noMethod" | "noImages" | "noElement" | "cannotDrawImages" | "noSlot">;

/** Why an id has no element of its own: another element already writes it, or Studio has no way to draw it (keys of `fields:reason`). */
export const HOSTED_BY: Readonly<Record<number, ReasonKey>> = {
  [VALUE_TYPE.hour]: "timeElement",
  [VALUE_TYPE.minute]: "timeElement",
  [VALUE_TYPE.hourHigh]: "timeHourDigit",
  [VALUE_TYPE.hourLow]: "timeHourDigit",
  [VALUE_TYPE.minuteHigh]: "timeMinuteDigit",
  [VALUE_TYPE.minuteLow]: "timeMinuteDigit",
  [VALUE_TYPE.secondHigh]: "timeSeconds",
  [VALUE_TYPE.secondLow]: "timeSeconds",
  [VALUE_TYPE.date]: "dateElement",
  [VALUE_TYPE.week]: "dateElement",
  [VALUE_TYPE.month]: "dateElement",
  [VALUE_TYPE.dateHigh]: "dateDigit",
  [VALUE_TYPE.dateLow]: "dateDigit",
  [VALUE_TYPE.hourRatio]: "hand",
  [VALUE_TYPE.minuteRatio]: "hand",
  [VALUE_TYPE.secondRatio]: "hand",
};

export const NO_ELEMENT: Readonly<Record<number, ReasonKey>> = {
  [VALUE_TYPE.weatherType]: "weatherType",
  [VALUE_TYPE.temperatureRatio]: "gauge",
  [VALUE_TYPE.dateYesterday]: "dateArc",
  [VALUE_TYPE.dateTomorrow]: "dateArc",
};

/** The reason text for an id that has no element of its own, in the active language. */
export function noElementReason(id: number): string | undefined {
  const key = HOSTED_BY[id] ?? NO_ELEMENT[id];
  return key === undefined ? undefined : i18n.t(`fields:reason.${key}`);
}

/** Name of a container slot, for the browser. */
export function slotName(slot: number): string {
  const name = (Object.keys(WIDGET_DATA_TYPE) as Array<keyof typeof WIDGET_DATA_TYPE>).find((k) => WIDGET_DATA_TYPE[k] === slot);
  return name ? `${slot} (${i18n.t(`fields:slot.${name}`)})` : String(slot);
}

/** Project files written before the registry stored a named source. */
export const LEGACY_WIDGET_SOURCES: Readonly<Record<string, number>> = {
  steps: VALUE_TYPE.steps,
  heartRate: VALUE_TYPE.heartRate,
  battery: VALUE_TYPE.power,
  calories: LEGACY_CALORIES_ID,
};

export const LEGACY_RING_SOURCES: Readonly<Record<string, number>> = {
  steps: VALUE_TYPE.stepsRatio,
  battery: VALUE_TYPE.powerRatio,
};

/** Number fields the editor offers in the data picker: drawable, in a known slot, and not just kept for old files. */
export function numberFields(): FieldDef[] {
  return FIELDS.filter((f) => f.number && f.slot !== undefined && !f.legacy);
}
export function ratioFields(): FieldDef[] {
  return FIELDS.filter((f) => f.ratio && f.slot !== undefined);
}
