import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { workoutDistanceParts } from '@/features/workouts/summary';
import { useTheme } from '@/theme';

import { BikeMap } from '../map/BikeMap';
import { useBikeMapStyle } from '../map/useBikeMapStyle';
import type { FieldContext } from '../fields/values';
import { fieldValue } from '../fields/values';
import type { NavSnapshot } from '../types';
import type { RidePalette } from './ridePalette';
import { RideButton } from './RideButton';
import { turnArrow } from './turn';

interface MapPageProps {
  ctx: FieldContext | null;
  nav: NavSnapshot | null;
  route: readonly { lat: number; lon: number }[] | null;
  position: { lat: number; lon: number; headingDeg: number | null } | null;
  palette: RidePalette;
}

/** The map page: speed, distance and the next turn on a strip at the top, the map under it, a notice while no offline region covers you. */
export function MapPage({ ctx, nav, route, position, palette }: MapPageProps) {
  const { t } = useTranslation('bikecomp');
  const { fonts } = useTheme();
  const router = useRouter();
  const [follow, setFollow] = useState(true);
  const { style, covered } = useBikeMapStyle({ variant: palette.theme, position: position ? { lat: position.lat, lon: position.lon } : null });

  const figure = { color: palette.foreground, fontFamily: fonts.numeral };
  const small = { color: palette.muted, fontFamily: fonts.bold };
  const speed = ctx ? fieldValue('speed', ctx) : null;
  const distance = ctx ? fieldValue('distance', ctx) : null;
  const cue = nav?.nextCue ?? null;
  const cueDistance = cue ? workoutDistanceParts(cue.distanceM) : null;
  const arrow = cue ? turnArrow(cue.cue.kind) : null;

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <View style={[styles.strip, { borderBottomColor: palette.hairline }]}>
        <View style={styles.cell}>
          <Text allowFontScaling={false} style={[styles.figure, figure]} numberOfLines={1}>
            {speed?.value ?? '--'}
            <Text style={[styles.unit, small]}> {speed?.unit ?? ''}</Text>
          </Text>
        </View>
        <View style={styles.cell}>
          <Text allowFontScaling={false} style={[styles.figure, figure]} numberOfLines={1}>
            {distance?.value ?? '--'}
            <Text style={[styles.unit, small]}> {distance?.unit ?? ''}</Text>
          </Text>
        </View>
        {nav ? (
          <View
            accessible
            accessibilityLabel={cue && cueDistance ? `${t(`turn.${cue.cue.kind}`)}, ${cueDistance.value} ${cueDistance.unit}` : t('page.map.turnNone')}
            style={[styles.cell, styles.turn]}>
            {cue && arrow && cueDistance ? (
              <>
                <Ionicons name={arrow.icon} size={34} color={palette.accent} style={{ transform: [{ rotate: `${arrow.rotateDeg}deg` }] }} />
                <Text allowFontScaling={false} style={[styles.figure, figure]} numberOfLines={1}>
                  {cueDistance.value}
                  <Text style={[styles.unit, small]}> {cueDistance.unit}</Text>
                </Text>
              </>
            ) : (
              <Text allowFontScaling={false} style={[styles.none, small]} numberOfLines={2}>
                {t('page.map.turnNone')}
              </Text>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.map}>
        {position ? (
          <BikeMap
            style={style}
            route={route}
            position={position}
            follow={follow}
            offCourse={nav?.offCourse ?? false}
            colors={{ route: palette.accent, routeCasing: palette.background, puck: palette.foreground, offCourse: palette.offCourse }}
            onFollowChange={setFollow}
            height="fill"
          />
        ) : (
          <View style={styles.waiting}>
            <Text style={[styles.waitingText, small]}>{t('page.map.noPosition')}</Text>
          </View>
        )}
        {!covered ? (
          <View style={[styles.notice, { backgroundColor: palette.surface, borderTopColor: palette.hairline }]}>
            <Text style={[styles.noticeText, { color: palette.foreground, fontFamily: fonts.bold }]}>{t('page.map.offlineNotice')}</Text>
            <RideButton label={t('page.map.offlineAction')} icon="settings-outline" palette={palette} variant="outline" onPress={() => router.push('/settings/bikecomputer')} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { flex: 1 },
  turn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  figure: { fontSize: 34, lineHeight: 38, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 14 },
  none: { fontSize: 14, lineHeight: 18 },
  map: { flex: 1 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  waitingText: { fontSize: 18 },
  notice: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  noticeText: { fontSize: 16, lineHeight: 22 },
});
