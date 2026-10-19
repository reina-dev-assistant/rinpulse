import { CATEGORY_DRAW_TYPES, VALUE_TYPES, type DataCategory, type ValueTypeInfo } from "@joyofit/hwt";
import { levelOfId, type SupportLevel } from "@/export/support";
import { i18n } from "@/i18n";
import { newIconSet, newRing, newWidget } from "@/model/defaults";
import { noElementReason, fieldDef, slotName } from "@/model/fields";
import type { Element } from "@/model/types";
import { canDrawIconSet } from "@/render/iconsets";

/**
 * What the field browser offers for each codec value id. Evidence comes from `levelOfId`, the function the export gate uses, so
 * the badge in the browser and what the export writes cannot disagree: an action is enabled only when the element it makes
 * has that same level, and an unknown id has no enabled action.
 */
export type FieldActionKind = "number" | "ring" | "iconset";

export type ActionState = { enabled: true } | { enabled: false; reason: string };

export interface FieldAction {
  kind: FieldActionKind;
  label: string;
  state: ActionState;
}

export interface FieldRow {
  info: ValueTypeInfo;
  level: SupportLevel;
  /** Badge text: verified, unconfirmed or unknown (preview only). */
  badge: string;
  /** Layer types the Huawei docs allow for this data category, as short names. */
  drawTypes: string[];
  /** Studio's own name for the field (the codec calls id 9 "Power", Studio "Battery"), when it has one. */
  label: string | null;
  /** Container `data_type` the export would use, when Studio knows it. */
  slot: string | null;
  action: FieldAction;
}

const KIND_OF: Record<DataCategory, FieldActionKind> = { raw: "number", text: "number", ratio: "ring", enum: "iconset" };
/** The layer type each action writes through `FaceBuilder`. */
const NEEDS: Record<FieldActionKind, string> = { number: "DRAW_TYPE_COMBINED_RES", ring: "DRAW_TYPE_ARC_RES", iconset: "DRAW_TYPE_SELECTED_RES" };

const BADGE_KEY: Record<SupportLevel, "verified" | "experimental" | "previewOnly"> = { verified: "verified", experimental: "experimental", "preview-only": "previewOnly" };

export function fieldAction(info: ValueTypeInfo): FieldAction {
  const kind = KIND_OF[info.category];
  const label = i18n.t(`fields:action.${kind}`);
  const no = (reason: string): FieldAction => ({ kind, label, state: { enabled: false, reason } });

  if (levelOfId(info.id) === "preview-only") return no(i18n.t("fields:reason.unknownId"));
  const elsewhere = noElementReason(info.id);
  if (elsewhere) return no(elsewhere);
  if (!CATEGORY_DRAW_TYPES[info.category].includes(NEEDS[kind])) return no(i18n.t("fields:reason.noMethod"));
  const def = fieldDef(info.id);
  const spec = kind === "number" ? def?.number : kind === "ring" ? def?.ratio : def?.iconSet;
  if (!def || !spec) return no(i18n.t(kind === "iconset" ? "fields:reason.noImages" : "fields:reason.noElement"));
  if (kind === "iconset" && !canDrawIconSet(info.id)) return no(i18n.t("fields:reason.cannotDrawImages"));
  if (def.slot === undefined) return no(i18n.t("fields:reason.noSlot"));
  return { kind, label, state: { enabled: true } };
}

const shortDrawType = (t: string) => t.replace("DRAW_TYPE_", "").toLowerCase().replaceAll("_", " ");

export function fieldRows(): FieldRow[] {
  return VALUE_TYPES.map((info) => {
    const level = levelOfId(info.id);
    const def = fieldDef(info.id);
    const slot = def?.slot;
    return {
      info,
      label: def && def.label !== info.name ? def.label : null,
      level,
      badge: i18n.t(`fields:badge.${BADGE_KEY[level]}`),
      drawTypes: CATEGORY_DRAW_TYPES[info.category].map(shortDrawType),
      slot: slot === undefined ? null : slotName(slot),
      action: fieldAction(info),
    };
  });
}

/** Rows whose codec name, Studio name, id, category or badge contain every word of `query`. */
export function filterRows(rows: FieldRow[], query: string): FieldRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((r) => {
    const hay = `${r.info.name} ${r.label ?? ""} ${r.info.id} ${r.info.category} ${r.badge}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The element an enabled action adds. */
export function makeFieldElement(id: number, kind: FieldActionKind): Element {
  if (kind === "number") return newWidget(id);
  if (kind === "ring") return newRing(id, { size: 168, thickness: 12, x: 120, y: 156 });
  return newIconSet(id);
}
