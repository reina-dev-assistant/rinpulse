import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BarReadout, useBarScrub } from '@/components/BarChart';
import { Details } from '@/components/Details';
import { CountUpText } from '@/components/motion';
import { Ring } from '@/components/Ring';
import { Section } from '@/components/Screen';
import { STRAIN_MAX, type DayStrain } from '@/features/today/strain';
import { STRAIN_DAYS } from '@/features/today/useTodayData';
import { fmtDate, fmtDecimal, fmtInt, INTL_TAG, getLocale, t as translate } from '@/i18n';
import { radius, spacing, useColors } from '@/theme';

const BAR_HEIGHT = 56;
function formatStrain(strain: number): string {
  return fmtDecimal(strain, 1);
}

/** Words for where a day's strain sits; the cut points split the 0..21 curve at roughly rest, walk, run, hard. */
export function strainWord(strain: number): string {
  if (strain < 5) return translate('today:strain.light');
  if (strain < 10) return translate('today:strain.moderate');
  if (strain < 14) return translate('today:strain.high');
  return translate('today:strain.allOut');
}

function weekdayNarrow(day: number): string {
  return new Date(day * 1000).toLocaleDateString(INTL_TAG[getLocale()], { weekday: 'narrow' });
}

/** Today's strain as a ring, minutes per zone, and the last seven days as bars. */
export function StrainSection({ days, dayStart, maxHr }: { days: readonly DayStrain[]; dayStart: number; maxHr: number }) {
  const colors = useColors();
  const { t } = useTranslation('today');
  const byDay = new Map(days.map((d) => [d.day, d]));
  const week = Array.from({ length: STRAIN_DAYS }, (_, i) => {
    // Local midnights: step back a day at noon so a DST shift cannot land on the wrong date.
    const noon = new Date((dayStart + 12 * 3600) * 1000);
    noon.setDate(noon.getDate() - (STRAIN_DAYS - 1 - i));
    noon.setHours(0, 0, 0, 0);
    const day = Math.floor(noon.getTime() / 1000);
    return { day, strain: byDay.get(day)?.strain ?? null };
  });
  const today = byDay.get(dayStart) ?? null;
  const scrub = useBarScrub(week.length, dayStart);
  const picked = scrub.selected !== null ? week[scrub.selected]! : null;
  const hard = today ? Math.round(today.zoneMinutes[2] + today.zoneMinutes[3] + today.zoneMinutes[4]) : 0;
  const easy = today ? Math.round(today.zoneMinutes[0] + today.zoneMinutes[1]) : 0;

  return (
    <Section title={t('strain.title')} icon="flash" tint="workouts">
      <View style={styles.row}>
        <Ring
          size={80}
          stroke={7}
          value={today?.strain ?? 0}
          max={STRAIN_MAX}
          color={colors.workouts}
          track={colors.workoutsSoft}
          accessibilityLabel={today ? t('strain.ringA11y', { value: formatStrain(today.strain), max: STRAIN_MAX }) : t('strain.ringNoneA11y')}>
          <View style={styles.center}>
            <CountUpText
              variant="heading"
              color={colors.workoutsText}
              value={today ? Number(today.strain.toFixed(1)) : null}
              decimals={1}
              style={styles.value}
            />
            <AppText variant="caption" muted style={styles.small}>
              {t('strain.ofMax', { max: STRAIN_MAX })}
            </AppText>
          </View>
        </Ring>
        <View style={styles.text}>
          <AppText variant="bodyStrong">{today ? strainWord(today.strain) : t('strain.none')}</AppText>
          {today ? (
            <AppText variant="caption" muted>
              {t('strain.zones', { hard: fmtInt(hard), easy: fmtInt(easy) })}
            </AppText>
          ) : null}
        </View>
      </View>
      <BarReadout
        title={picked ? fmtDate(picked.day, 'weekday') : null}
        text={picked ? (picked.strain !== null ? t('strain.barValue', { value: formatStrain(picked.strain), max: STRAIN_MAX }) : t('strain.noneDay')) : null}
        color={colors.workoutsText}
      />
      <View {...scrub.touch} style={styles.bars}>
        {week.map(({ day, strain }, i) => (
          <View
            key={day}
            accessible
            accessibilityLabel={`${fmtDate(day, 'weekday')}: ${strain !== null ? t('strain.barValue', { value: formatStrain(strain), max: STRAIN_MAX }) : t('strain.noneDay')}`}
            style={styles.barCol}>
            <View style={[styles.barTrack, { backgroundColor: colors.workoutsSoft }]}>
              {strain !== null ? (
                <View
                  style={[
                    styles.barFill,
                    {
                      height: Math.max(3, (BAR_HEIGHT * strain) / STRAIN_MAX),
                      backgroundColor: day === dayStart ? colors.workouts : colors.workoutsText,
                      opacity: scrub.selected !== null && scrub.selected !== i ? 0.5 : 1,
                    },
                  ]}
                />
              ) : null}
            </View>
            <AppText variant="caption" muted={scrub.selected !== i} color={scrub.selected === i ? colors.workoutsText : undefined} style={styles.small}>
              {strain !== null ? formatStrain(strain) : '-'}
            </AppText>
            <AppText variant="caption" muted style={styles.small}>
              {weekdayNarrow(day)}
            </AppText>
          </View>
        ))}
      </View>
      <Details>{t('strain.details', { maxHr })}</Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  center: { alignItems: 'center' },
  value: { fontVariant: ['tabular-nums'] },
  small: { fontSize: 11, lineHeight: 14 },
  text: { flex: 1, gap: 4 },
  bars: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  barCol: { alignItems: 'center', gap: 2, flex: 1 },
  barTrack: { width: 14, height: BAR_HEIGHT, borderRadius: radius.pill, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: radius.pill },
});
