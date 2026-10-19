import { useTranslation } from 'react-i18next';

import { NavRow } from '@/components/NavRow';
import { fmtDay, fmtInt } from '@/i18n';
import { sessionTitle } from '../format';
import type { SessionStatus } from '../progress';
import type { PlannedSession } from '../plans/types';
import { SESSION_GLYPH } from './sessionGlyph';

/** One planned session in a list: type, day and minutes, and how it stands. Opens the session's details. */
export function SessionRow({ session, status, onPress }: { session: PlannedSession; status: SessionStatus; onPress: () => void }) {
  const { t } = useTranslation('coach');
  const minutes = t('unit.min', { value: fmtInt(session.minutes) });
  return (
    <NavRow
      {...(status === 'done' ? { icon: 'checkmark-circle' as const } : SESSION_GLYPH[session.type])}
      tint={status === 'missed' ? 'heart' : 'workouts'}
      title={sessionTitle(session)}
      subtitle={`${fmtDay(session.day, 'weekday')} \u00b7 ${minutes}`}
      value={t(`plan.status.${status}`)}
      onPress={onPress}
      disabled={status === 'beforeStart'}
    />
  );
}
