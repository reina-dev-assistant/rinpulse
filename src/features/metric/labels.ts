import { fmtDate, t } from '@/i18n';
import type { Period } from '@/features/metric/range';
import { addDays } from '@/features/trends/series';

/** The period in words for the line between the step buttons. */
export function periodLabel(period: Period, todayStart: number): string {
  switch (period.range) {
    case 'D':
      if (period.from === todayStart) return t('common:time.today');
      if (period.from === addDays(todayStart, -1)) return t('common:time.yesterday');
      return fmtDate(period.from, 'weekday');
    case 'W':
    case '3M':
      return `${fmtDate(period.from, 'short')} - ${fmtDate(addDays(period.to, -1), 'short')}`;
    case 'M':
      return fmtDate(period.from, 'month');
    case 'Y':
      return String(new Date((period.from + 12 * 3600) * 1000).getFullYear());
  }
}
