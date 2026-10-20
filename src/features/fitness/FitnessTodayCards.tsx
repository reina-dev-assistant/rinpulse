import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { CountUpText, FadeIn } from '@/components/motion';
import { NavRow } from '@/components/NavRow';
import { Ring } from '@/components/Ring';
import { Card } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import { StatTile } from '@/components/StatTile';
import { computeDailyFitness } from '@/features/fitness/compute';
import { energyWord } from '@/features/fitness/energy';
import { formatHm, formatRecovery, sourceLabel } from '@/features/fitness/format';
import { Paragraphs } from '@/features/fitness/Paragraphs';
import { Sparkline } from '@/features/fitness/Sparkline';
import type { FitnessData } from '@/features/fitness/useFitnessData';
import type { NightHrvAvailability } from '@/features/today/nightHrv';
import { fmtInt, useLocale, useTranslation } from '@/i18n';
import { spacing, useColors } from '@/theme';

const SIZE = 92;
const STROKE = 8;

/** Today card: Energi Tubuh, recovery time and the sleep tonight needs. The way into Kebugaran is `FitnessLinkCard`. */
export function FitnessTodayCards({ data, availability }: { data: FitnessData | null; availability: NightHrvAvailability | null }) {
  const { t } = useTranslation('health');
  const locale = useLocale();
  const colors = useColors();
  const daily = useMemo(() => (data ? computeDailyFitness(data, availability) : null), [data, availability, locale]);

  if (!daily) return <Skeleton width="100%" height={220} radius="card" />;

  const { energy, recovery, sleepNeed } = daily;
  const recoveryText = recovery ? formatRecovery(recovery.hoursLeft) : null;

  return (
    <FadeIn>
      <Card>
        <View style={styles.energyRow}>
          <Ring
            size={SIZE}
            stroke={STROKE}
            value={energy?.level ?? 0}
            max={100}
            color={colors.steps}
            track={colors.stepsSoft}
            accessibilityLabel={energy ? t('fitness.today.energyA11y', { level: fmtInt(energy.level) }) : t('fitness.today.energyA11yNone')}>
            {energy ? (
              <CountUpText variant="heading" value={Math.round(energy.level)} decimals={0} suffix="" style={styles.value} />
            ) : (
              <AppText variant="heading">--</AppText>
            )}
          </Ring>
          <View style={styles.energyText}>
            <AppText variant="bodyStrong">{t('fitness.today.energyTitle')}</AppText>
            {energy ? (
              <>
                <AppText variant="caption" muted>
                  {t('fitness.today.energyLine', { word: energyWord(energy.level) })}
                </AppText>
                <Sparkline values={energy.series.map((p) => p.level)} color={colors.steps} domain={[0, 100]} label={t('fitness.today.energySeries')} />
              </>
            ) : (
              <AppText variant="caption" muted>
                {daily.energyMissing}
              </AppText>
            )}
          </View>
        </View>
        <Details title={t('fitness.today.howTitle')}>
          <Paragraphs
            lines={[
              t('fitness.today.howEnergy'),
              ...(energy
                ? [
                    t('fitness.today.howEnergyNow', {
                      wake: fmtInt(energy.wakeLevel),
                      awake: fmtInt(energy.parts.awake),
                      strain: fmtInt(energy.parts.strain),
                      stress: fmtInt(energy.parts.stress),
                      naps: `+${fmtInt(energy.parts.naps)}`,
                      rest: `+${fmtInt(energy.parts.rest)}`,
                    }),
                  ]
                : []),
            ]}
          />
        </Details>

        <View style={styles.tiles}>
          <StatTile
            icon="hourglass"
            tint="workouts"
            label={t('fitness.today.recoveryLabel')}
            value={recoveryText ? recoveryText.value : '--'}
            unit={recoveryText?.unit}
            sub={recovery ? sourceLabel(recovery.source) : t('fitness.today.recoveryNone')}
          />
          <StatTile icon="bed" tint="sleep" label={t('fitness.today.sleepTonightLabel')} value={formatHm(sleepNeed.needSec)} sub={t('fitness.today.estimate')} />
        </View>
        <Details title={t('fitness.today.howRecoveryTitle')}>
          {recovery?.source === 'watch' ? t('fitness.today.howRecoveryWatch') : t('fitness.today.howRecoveryEstimate')}
        </Details>
        <Details title={t('fitness.today.howNeedTitle')}>
          <Paragraphs
            lines={[
              t('fitness.today.howNeed'),
              ...(sleepNeed.strainExtraSec > 0 ? [t('fitness.today.howNeedStrain', { duration: formatHm(sleepNeed.strainExtraSec) })] : []),
              ...(sleepNeed.debtExtraSec > 0 ? [t('fitness.today.howNeedDebt', { duration: formatHm(sleepNeed.debtExtraSec) })] : []),
              ...(sleepNeed.debtSec === null ? [t('fitness.today.howNeedNoDebt')] : []),
            ]}
          />
        </Details>
      </Card>
    </FadeIn>
  );
}

/** The way into the Kebugaran screen: a card of its own, so it can sit with the secondary cards of Today. */
export function FitnessLinkCard() {
  const { t } = useTranslation('health');
  const router = useRouter();
  return (
    <Card>
      <NavRow icon="analytics" tint="link" title={t('fitness.today.navTitle')} subtitle={t('fitness.today.navSubtitle')} onPress={() => router.push('/fitness')} />
    </Card>
  );
}

const styles = StyleSheet.create({
  energyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  energyText: { flex: 1, gap: spacing.xs },
  value: { fontVariant: ['tabular-nums'] },
  tiles: { flexDirection: 'row', gap: spacing.md },
});
