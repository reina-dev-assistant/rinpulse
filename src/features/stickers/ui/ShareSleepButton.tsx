import { useMemo } from 'react';

import type { Night } from '@/features/sleep/nights';
import { useLocale, useTranslation } from '@/i18n';

import { buildSleepSubject } from '../data/sleep';
import { ShareEntryButton } from './ShareEntryButton';

/** Share one night (or nap). `recentAsleepSec` are the asleep seconds of other recent nights, not this one. */
export function ShareSleepButton({ night, recentAsleepSec }: { night: Night; recentAsleepSec: readonly number[] }) {
  const { t } = useTranslation('stickers');
  const locale = useLocale();
  const subject = useMemo(() => buildSleepSubject({ night, recentAsleepSec }, locale), [night, recentAsleepSec, locale]);
  return <ShareEntryButton subject={subject} label={t('ui.entry.sleep')} />;
}
