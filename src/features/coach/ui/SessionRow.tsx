import { useTranslation } from 'react-i18next';

import type { IconName } from '@/components/IconChip';
import { NavRow } from '@/components/NavRow';
import { fmtDay, fmtInt } from '@/i18n';
import { sessionTitle } from '../format';
import type { SessionStatus } from '../progress';
import type { PlannedSession, SessionType } from '../plans/types';

const ICON: Record<SessionType, IconName> = {
  easy: 'walk',
  recovery: 'leaf',
  long: 'trail-sign',
  tempo: 'speedometer',
  intervals: 'flash',
  walkrun: 'footsteps',
  race: 'trophy',
  strength: 'barbell',
};

/** One planned session in a list: type, day and minutes, and how it stands. Opens the session's details. */
export function SessionRow({ session, status, onPress }: { session: PlannedSession; status: SessionStatus; onPress: () => void }) {
  const { t } = useTranslation('coach');
  const minutes = t('unit.min', { value: fmtInt(session.minutes) });
  return (
    <NavRow
      icon={status === 'done' ? 'checkmark-circle' : ICON[session.type]}
      tint={status === 'missed' ? 'heart' : 'workouts'}
      title={sessionTitle(session)}
      subtitle={`${fmtDay(session.day, 'weekday')} \u00b7 ${minutes}`}
      value={t(`plan.status.${status}`)}
      onPress={onPress}
      disabled={status === 'beforeStart'}
    />
  );
}
