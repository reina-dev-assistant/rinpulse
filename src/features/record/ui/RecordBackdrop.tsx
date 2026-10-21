import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { HeroGradient } from '@/components/HeroGradient';
import { BikeMap } from '@/features/bikecomputer/map/BikeMap';
import { ridePalette } from '@/features/bikecomputer/map/ridePalette';
import { useBikeMapStyle } from '@/features/bikecomputer/map/useBikeMapStyle';
import type { ManualSport } from '@/features/workouts/manual';
import { spacing, useTheme } from '@/theme';

import type { RecordingSnapshot } from '../controller';
import type { PermissionAnswer } from './format';
import { useStageInset } from './RecordStage';
import { StatPreview } from './StatPreview';

interface MapBackdropProps {
  position: RecordingSnapshot['position'];
  location: PermissionAnswer;
}

/**
 * The map under the screen: the ride basemap (the installed offline region where there is one, else online) in the day or night look
 * of the theme, with the route line colour and the position dot in the theme's primary colour. Until the first fix there is no place
 * to show, so the space says what it waits for instead of drawing a map of the whole country. The last place stays on the map while the
 * GPS looks again (the warm-up restarts when the person comes back from the sensors page).
 */
export function MapBackdrop({ position, location }: MapBackdropProps) {
  const { t } = useTranslation('workouts');
  const { colors, scheme } = useTheme();
  const inset = useStageInset();
  const variant = scheme === 'dark' ? 'night' : 'day';
  const [shown, setShown] = useState(position);
  if (position && position !== shown) setShown(position);
  const { style } = useBikeMapStyle({ variant, position: shown });
  const [follow, setFollow] = useState(true);

  if (shown) {
    const ground = ridePalette(variant === 'night' ? 'dark' : 'light').background;
    return (
      <View style={styles.fill}>
        <BikeMap
          style={style}
          route={null}
          position={shown}
          follow={follow}
          offCourse={false}
          colors={{ route: colors.primary, routeCasing: ground, puck: colors.primary, offCourse: colors.destructive }}
          onFollowChange={setFollow}
          flat
          inset={inset}
        />
      </View>
    );
  }

  const waiting = location === 'granted' ? 'searching' : 'needsLocation';
  const text = t(`record.setup.map.${waiting}`);
  return (
    <View
      accessible
      accessibilityLabel={text}
      style={[styles.fill, styles.waiting, { backgroundColor: colors.muted, paddingTop: inset.top, paddingBottom: inset.bottom }]}>
      <Ionicons name={waiting === 'searching' ? 'navigate-outline' : 'map-outline'} size={32} color={colors.mutedForeground} />
      <AppText variant="caption" muted style={styles.waitingText}>
        {text}
      </AppText>
    </View>
  );
}

/**
 * The top of the screen of a sport with no GPS: no map to look at, so the figures it will record are the screen, large, on the dark
 * hero panel that the live screen uses too.
 */
export function IndoorBackdrop({ sport }: { sport: ManualSport }) {
  const { t } = useTranslation('workouts');
  const { colors } = useTheme();
  const inset = useStageInset();
  return (
    <View style={[styles.fill, styles.hero, { backgroundColor: colors.hero, paddingTop: inset.top, paddingBottom: inset.bottom + spacing.md }]}>
      <HeroGradient />
      <StatPreview sport={sport} layout="stacked" />
      <AppText variant="caption" color={colors.heroMuted} style={styles.heroNote}>
        {t('record.setup.noGpsNote')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  waiting: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  waitingText: { textAlign: 'center' },
  hero: { justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.lg },
  heroNote: { textAlign: 'center' },
});
