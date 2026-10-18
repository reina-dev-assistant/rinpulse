import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { fmtDecimal, fmtDistance, fmtInt } from '@/i18n';
import { spacing } from '@/theme';

import type { RideSnapshot } from '../session';
import { gameFigures } from './format';

interface GameCardProps {
  game: RideSnapshot['game'];
  onGear: (d: 1 | -1) => void;
}

/** What the game says about the ride (virtual speed, distance, grade, gear, ESTIMATED power) with gear buttons for the phone. */
export function GameCard({ game, onGear }: GameCardProps) {
  const { t } = useTranslation(['ride', 'workouts']);
  const figures = gameFigures(game);
  return (
    <Card>
      <View style={styles.head}>
        <AppText variant="bodyStrong">{t('ride:live.title')}</AppText>
        {figures ? (
          <AppText variant="caption" muted numberOfLines={1} style={styles.route}>
            {figures.route}
          </AppText>
        ) : null}
      </View>
      {figures ? (
        <>
          <View style={styles.tiles}>
            <StatTile icon="speedometer" tint="link" label={t('ride:live.speed')} value={fmtDecimal(figures.speedKmh, 1)} unit={t('workouts:analysis.unit.kmh')} />
            <StatTile icon="trail-sign" tint="workouts" label={t('ride:live.distance')} value={fmtDistance(figures.distanceM)} />
          </View>
          <View style={styles.tiles}>
            <StatTile icon="trending-up" tint="steps" label={t('ride:live.grade')} value={fmtDecimal(figures.gradePct, 1)} unit="%" />
            <StatTile icon="flash" tint="heart" label={t('ride:live.power')} value={fmtInt(figures.powerW)} unit={t('workouts:analysis.unit.w')} />
          </View>
          <View style={styles.gear}>
            <Button label={t('ride:live.gearDown')} icon="remove" style={styles.gearButton} onPress={() => onGear(-1)} />
            <View accessible accessibilityLabel={`${t('ride:live.gear')}: ${t('ride:live.gearValue', { gear: figures.gear, count: figures.gearCount })}`} style={styles.gearValue}>
              <AppText variant="label" muted>
                {t('ride:live.gear')}
              </AppText>
              <AppText variant="figure">{t('ride:live.gearValue', { gear: figures.gear, count: figures.gearCount })}</AppText>
            </View>
            <Button label={t('ride:live.gearUp')} icon="add" style={styles.gearButton} onPress={() => onGear(1)} />
          </View>
        </>
      ) : (
        <AppText variant="caption" muted>
          {t('ride:live.waiting')}
        </AppText>
      )}
      <AppText variant="caption" muted>
        {t('ride:live.note')}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  route: { flexShrink: 1 },
  tiles: { flexDirection: 'row', gap: spacing.md },
  gear: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gearButton: { flex: 1, minHeight: 52 },
  gearValue: { alignItems: 'center', minWidth: 96 },
});
