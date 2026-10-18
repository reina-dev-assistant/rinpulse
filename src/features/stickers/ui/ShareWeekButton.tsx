import { useTranslation } from '@/i18n';

import { ShareEntryButton } from './ShareEntryButton';
import { useWeekSubject } from './useWeekSubject';

/** Share the current week (recap and load). Not drawn while loading or when the week has nothing to show. */
export function ShareWeekButton({ dataVersion }: { dataVersion?: number }) {
  const { t } = useTranslation('stickers');
  const subject = useWeekSubject(dataVersion);
  return subject ? <ShareEntryButton subject={subject} label={t('ui.entry.week')} /> : null;
}
