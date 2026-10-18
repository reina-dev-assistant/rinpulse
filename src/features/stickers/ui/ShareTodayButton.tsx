import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';

import { PressableScale } from '@/components/PressableScale';
import type { DayShareInput } from '@/features/share/dayShareStats';
import { buildTodaySubject } from '@/features/stickers/data/today';
import { StickerSheet } from '@/features/stickers/ui/StickerSheet';
import { useLocale } from '@/i18n';
import { HIT, useColors } from '@/theme';

interface Props {
  day: DayShareInput;
  nowMs: number;
  stepGoal: number | null;
  restingHr: number | null;
}

/** Icon button for the Today header: opens the sticker sheet with steps, sleep and the day's scores. */
export function ShareTodayButton({ day, nowMs, stepGoal, restingHr }: Props) {
  const colors = useColors();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const subject = useMemo(
    () => buildTodaySubject({ ...day, stepGoal, restingHr, nowMs }, locale),
    [day, stepGoal, restingHr, nowMs, locale],
  );
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={subject.heading}
        onPress={() => setOpen(true)}
        style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="share-outline" size={24} color={colors.foreground} />
      </PressableScale>
      <StickerSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
