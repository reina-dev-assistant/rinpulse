import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { workoutDistanceParts } from '@/features/workouts/summary';
import { fmtDecimal, fmtInt } from '@/i18n';
import { useTheme } from '@/theme';

import type { NavSnapshot } from '../types';
import { ElevationStrip } from './ElevationStrip';
import { cropProfile, stripWindow, type ElevationPoint } from './elevationGeometry';
import type { RidePalette } from './ridePalette';

interface ClimbPageProps {
  nav: NavSnapshot | null;
  hasRoute: boolean;
  elevationStrip: readonly ElevationPoint[] | null;
  palette: RidePalette;
}

/** The climb page: the next climb (or the one you are on) and the route's elevation with your position. */
export function ClimbPage({ nav, hasRoute, elevationStrip, palette }: ClimbPageProps) {
  const { t } = useTranslation('bikecomp');
  const { fonts } = useTheme();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => setBox(event.nativeEvent.layout);

  const message = !hasRoute ? t('page.climb.empty') : !elevationStrip || elevationStrip.length < 2 ? t('page.climb.noProfile') : null;
  if (message !== null) {
    return (
      <View style={[styles.empty, { backgroundColor: palette.background }]}>
        <Text style={[styles.emptyText, { color: palette.foreground, fontFamily: fonts.bold }]}>{message}</Text>
      </View>
    );
  }

  const climb = nav?.climb ?? null;
  const grade = climb ? fmtDecimal(climb.climb.avgGradePct, 1) : null;
  const length = climb ? workoutDistanceParts(climb.climb.lengthM) : null;
  const left = climb ? fmtInt(Math.round(climb.remainingAscentM)) : null;
  const category = climb ? (climb.climb.category === null ? t('page.climb.categoryNone') : t('page.climb.category', { category: climb.climb.category })) : null;
  const heading = climb
    ? climb.inProgress
      ? t('page.climb.inProgress')
      : t('page.climb.startsIn', { distance: `${workoutDistanceParts(climb.startsInM).value} ${workoutDistanceParts(climb.startsInM).unit}` })
    : t('page.climb.noneLeft');

  const total = elevationStrip?.[elevationStrip.length - 1]?.distM ?? 0;
  const view = stripWindow(climb ? { startM: climb.climb.startM, endM: climb.climb.endM } : null, nav ? nav.distanceDoneM : null, total);
  const shownProfile = elevationStrip ? cropProfile(elevationStrip, view.fromM, view.toM) : [];

  const stats: { label: string; value: string; unit: string }[] = climb
    ? [
        { label: t('page.climb.length'), value: length?.value ?? '--', unit: length?.unit ?? '' },
        { label: t('page.climb.avgGrade'), value: grade ?? '--', unit: '%' },
        { label: t('page.climb.remainingAscent'), value: left ?? '--', unit: 'm' },
      ]
    : [];

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <View style={styles.head}>
        <Text style={[styles.heading, { color: palette.foreground, fontFamily: fonts.heavy }]} numberOfLines={1}>
          {heading}
        </Text>
        {category ? <Text style={[styles.category, { color: palette.muted, fontFamily: fonts.bold }]}>{category}</Text> : null}
      </View>
      {stats.length > 0 ? (
        <View style={styles.stats}>
          {stats.map((stat) => (
            <View key={stat.label} accessible accessibilityLabel={`${stat.label}: ${stat.value} ${stat.unit}`} style={styles.stat}>
              <Text style={[styles.statLabel, { color: palette.muted, fontFamily: fonts.bold }]} numberOfLines={1}>
                {stat.label}
              </Text>
              <Text style={[styles.statValue, { color: palette.foreground, fontFamily: fonts.numeral }]} numberOfLines={1}>
                {stat.value}
                <Text style={[styles.statUnit, { color: palette.muted }]}> {stat.unit}</Text>
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.strip} onLayout={onLayout}>
        {box.width > 0 && shownProfile.length > 1 ? (
          <ElevationStrip
            elevationStrip={shownProfile}
            positionM={nav ? nav.distanceDoneM : null}
            climb={climb ? { startM: climb.climb.startM, endM: climb.climb.endM } : null}
            width={box.width}
            height={box.height}
            palette={palette}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyText: { fontSize: 22, lineHeight: 30, textAlign: 'center' },
  head: { paddingHorizontal: 16, paddingTop: 12, gap: 2 },
  heading: { fontSize: 30, lineHeight: 34 },
  category: { fontSize: 16, lineHeight: 22 },
  stats: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  stat: { flex: 1, gap: 2 },
  statLabel: { fontSize: 13, lineHeight: 18 },
  statValue: { fontSize: 38, lineHeight: 42, fontVariant: ['tabular-nums'] },
  statUnit: { fontSize: 16 },
  strip: { flex: 1, marginTop: 12 },
});
