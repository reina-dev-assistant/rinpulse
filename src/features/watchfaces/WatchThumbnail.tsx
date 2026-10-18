import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { Skeleton } from '@/components/States';
import type { WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import { radius, spacing, tintColors, useColors } from '@/theme';
import type { WatchfaceInfo } from '@/wear';

/** "Active" badge on the face that is currently active on the watch screen. */
export function ActivePill() {
  const { t } = useTranslation('watch');
  const colors = useColors();
  const link = tintColors(colors, 'link');
  return (
    <View style={[styles.pill, { backgroundColor: link.soft }]}>
      <AppText variant="label" color={link.text}>
        {t('faces.activeOnWrist')}
      </AppText>
    </View>
  );
}

/** Stand-in skeleton card while the watch face list is being loaded over BLE. */
export function FaceSkeleton() {
  return (
    <Card>
      <View style={styles.faceHeader}>
        <Skeleton width={40} height={40} radius={20} />
        <View style={styles.faceText}>
          <Skeleton width="55%" height={16} />
          <Skeleton width="35%" height={12} />
        </View>
      </View>
      <View style={styles.skeletonActions}>
        <Skeleton width={120} height={48} radius={radius.pill} />
        <Skeleton width={96} height={48} radius={radius.pill} />
      </View>
    </Card>
  );
}

/** Realistic chassis thumbnail displaying the watch face without cut-off edges. */
export function WatchThumbnail({ face, active }: { face: WatchfaceItem; active?: boolean }) {
  const colors = useColors();
  const [imgError, setImgError] = useState(false);
  const isRound = face.category.startsWith('Round') || (face.width >= 450 && face.width === face.height);
  const isFit = face.category.startsWith('Fit') || face.width === 408 || face.width === 336;

  return (
    <View
      style={[
        styles.thumbBase,
        isRound ? styles.thumbRound : isFit ? styles.thumbFit : styles.thumbBand,
      ]}>
      {face.previewUrl && !imgError ? (
        <Image
          source={{ uri: face.previewUrl }}
          style={styles.fillImage}
          resizeMode="contain"
          onError={() => setImgError(true)}
        />
      ) : (
        <Ionicons name="time-outline" size={24} color={active ? colors.foreground : colors.mutedForeground} />
      )}
    </View>
  );
}

/** Visual tile for factory firmware dials that do not transfer preview bitmaps over BLE. */
export function FactoryThumbnail({
  face,
  active,
  screenWidth,
  screenHeight,
}: {
  readonly face: WatchfaceInfo;
  readonly active?: boolean;
  readonly screenWidth?: number | null;
  readonly screenHeight?: number | null;
}) {
  const colors = useColors();
  const w = screenWidth ?? 194;
  const isRound = w >= 440 || (screenHeight != null && w === screenHeight);
  const isFit = w === 408 || w === 336;

  return (
    <View
      style={[
        styles.thumbBase,
        isRound ? styles.thumbRound : isFit ? styles.thumbFit : styles.thumbBand,
        { backgroundColor: '#111827' },
      ]}>
      <Ionicons
        name={face.photo ? 'image-outline' : face.factory ? 'sparkles-outline' : 'watch-outline'}
        size={24}
        color={active ? colors.foreground : colors.mutedForeground}
      />
      <AppText variant="label" style={{ fontSize: 9, color: colors.mutedForeground, marginTop: 2 }}>
        {face.factory ? 'Factory' : face.photo ? 'Photo' : 'Dial'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  faceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  faceText: {
    flex: 1,
    gap: 2,
  },
  skeletonActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  thumbBase: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#050505',
  },
  thumbBand: {
    width: 38,
    height: 64,
    borderRadius: 12,
  },
  thumbRound: {
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  thumbFit: {
    width: 56,
    height: 66,
    borderRadius: 12,
  },
  fillImage: {
    width: '100%',
    height: '100%',
  },
});
