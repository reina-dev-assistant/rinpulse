import type { RogoAttachment, RogoAttachmentKind } from '@/cloud/rogo';
import type { IconName } from '@/components/IconChip';
import { fmtDay, fmtDecimal, fmtDistance, fmtDuration, fmtInt, t } from '@/i18n';

/** Kinds the "Dari aplikasi" picker offers, in the order it lists them. */
export const ATTACH_KINDS = ['workout', 'route', 'food', 'weight', 'recap'] as const;

export const ATTACHMENT_ICON: Record<RogoAttachmentKind, IconName> = {
  image: 'image',
  workout: 'barbell',
  route: 'trail-sign',
  food: 'restaurant',
  weight: 'scale',
  recap: 'stats-chart',
};

const MEAL_KEYS = { sarapan: 'breakfast', makan_siang: 'lunch', makan_malam: 'dinner', snack: 'snack' } as const;

const num = (value: number | string | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The heading of an attachment card: the server's title, or a word for the kinds that have none. */
export function attachmentTitle(a: RogoAttachment): string {
  if (a.title.trim() !== '') return a.title;
  return t(`social:comments.attach.kind.${a.kind}`);
}

/** The line under the heading: the kind and the day it belongs to. */
export function attachmentCaption(a: RogoAttachment): string {
  const kind = t(`social:comments.attach.kind.${a.kind}`);
  if (a.kind === 'recap') {
    const from = typeof a.stats.weekStart === 'string' ? a.stats.weekStart : null;
    const to = typeof a.stats.weekEnd === 'string' ? a.stats.weekEnd : null;
    if (from && to) return `${kind} · ${fmtDay(from, 'short')} – ${fmtDay(to, 'short')}`;
  }
  return a.date ? `${kind} · ${fmtDay(a.date, 'medium')}` : kind;
}

type FigureKey =
  | 'distance' | 'time' | 'energy' | 'avgHr' | 'sets' | 'volume' | 'meal' | 'protein' | 'carbs' | 'fat' | 'items'
  | 'weight' | 'delta' | 'avgKcal' | 'daysOnTarget' | 'streak' | 'exercise' | 'weightChange';

export interface AttachmentFigure {
  label: string;
  value: string;
}

function signed(value: number, unit: string): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtDecimal(Math.abs(value), 1)} ${unit}`;
}

/** The numbers an attachment shows; only those the server sent. */
export function attachmentFigures(a: RogoAttachment): AttachmentFigure[] {
  const s = a.stats;
  const out: AttachmentFigure[] = [];
  const add = (key: FigureKey, value: string | null) => {
    if (value !== null) out.push({ label: t(`social:comments.attach.figure.${key}`), value });
  };
  const distance = num(s.distanceM);
  const minutes = num(s.durationMin);
  const kcal = num(s.kcal);
  switch (a.kind) {
    case 'workout':
    case 'route':
      add('distance', distance ? fmtDistance(distance) : null);
      add('time', minutes ? fmtDuration(minutes * 60) : null);
      add('energy', kcal ? `${fmtInt(kcal)} kcal` : null);
      add('avgHr', num(s.avgHr) ? `${fmtInt(num(s.avgHr)!)} bpm` : null);
      add('sets', num(s.sets) ? fmtInt(num(s.sets)!) : null);
      add('volume', num(s.volumeKg) ? `${fmtInt(num(s.volumeKg)!)} kg` : null);
      break;
    case 'food': {
      const meal = typeof s.meal === 'string' && s.meal in MEAL_KEYS ? MEAL_KEYS[s.meal as keyof typeof MEAL_KEYS] : null;
      add('meal', meal ? t(`social:comments.attach.meal.${meal}`) : null);
      add('energy', kcal !== null ? `${fmtInt(kcal)} kcal` : null);
      add('protein', num(s.protein) !== null ? `${fmtInt(num(s.protein)!)} g` : null);
      add('carbs', num(s.carbs) !== null ? `${fmtInt(num(s.carbs)!)} g` : null);
      add('fat', num(s.fat) !== null ? `${fmtInt(num(s.fat)!)} g` : null);
      add('items', num(s.items) && num(s.items)! > 1 ? fmtInt(num(s.items)!) : null);
      break;
    }
    case 'weight': {
      const delta = num(s.deltaKg);
      add('weight', num(s.weightKg) !== null ? `${fmtDecimal(num(s.weightKg)!, 1)} kg` : null);
      add('delta', delta !== null ? signed(delta, 'kg') : null);
      break;
    }
    case 'recap': {
      const avg = num(s.avgKcal);
      const target = num(s.targetKcal);
      add('avgKcal', avg !== null ? `${fmtInt(avg)}${target !== null ? ` / ${fmtInt(target)}` : ''} kcal` : null);
      const onTarget = num(s.daysOnTarget);
      const logged = num(s.loggedDays);
      add('daysOnTarget', onTarget !== null ? (logged !== null ? `${fmtInt(onTarget)} / ${fmtInt(logged)}` : fmtInt(onTarget)) : null);
      add('streak', num(s.streakDays) ? t('social:comments.attach.days', { count: num(s.streakDays)! }) : null);
      add('exercise', num(s.exerciseMin) ? fmtDuration(num(s.exerciseMin)! * 60) : null);
      add('weightChange', num(s.weightChangeKg) !== null ? signed(num(s.weightChangeKg)!, 'kg') : null);
      break;
    }
    case 'image':
      break;
  }
  return out;
}
