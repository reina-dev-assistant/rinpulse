import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import type { DownloadedFace } from '@/features/watchfaces/useWatchfaceLibrary';
import { radius, spacing, useColors } from '@/theme';
import type { WatchfaceList } from '@/wear';

interface WatchStorageCardProps {
  readonly list: WatchfaceList;
  readonly library?: readonly DownloadedFace[];
}
interface StorageProfile {
  readonly totalMb: number;
  readonly maxSlots: number;
  readonly avgCustomFaceMb: number;
}

function resolveStorageProfile(width: number | null): StorageProfile {
  const w = width ?? 194;
  if (w <= 240) {
    // Band profile: Huawei Band 7/8/9/10
    return {
      totalMb: 32.0,
      maxSlots: 16,
      avgCustomFaceMb: 1.6,
    };
  }
  if (w <= 420) {
    // Fit profile: Huawei Watch Fit 2/3 (336x480, 408x480)
    return {
      totalMb: 128.0,
      maxSlots: 32,
      avgCustomFaceMb: 3.5,
    };
  }
  // Round profile: Huawei Watch GT 2/3/4/5 (454x454, 466x466)
  return {
    totalMb: 256.0,
    maxSlots: 50,
    avgCustomFaceMb: 4.8,
  };
}

/**
 * Storage and capacity meter card for installed watch faces.
 * Displays hardware telemetry if reported by the watch; otherwise computes
 * an accurate prediction based on flash partition capacity and installed faces.
 */
export function WatchStorageCard({ list, library = [] }: WatchStorageCardProps) {
  const { t } = useTranslation('watch');
  const colors = useColors();

  // Check if watch hardware provided real storage telemetry.
  // Note: Current Band and Fit BLE firmware commands (0x27) return installed face records without
  // partition capacity bytes. The hardware telemetry branch is wired and ready for future devices/firmware
  // that broadcast partition TLVs; current models safely run on the flash partition prediction branch below.
  const hasHardwareTelemetry =
    list.totalBytes != null &&
    list.freeBytes != null &&
    list.totalBytes > 0 &&
    list.freeBytes <= list.totalBytes;

  const profile = resolveStorageProfile(list.width);

  const customFaces = list.faces.filter((f) => !f.factory);
  const factoryFaces = list.faces.filter((f) => f.factory);

  let totalMb: number;
  let freeMb: number;
  let usedMb: number;
  let percent: number;
  let remainingSlots: number;

  if (hasHardwareTelemetry && list.totalBytes != null && list.freeBytes != null) {
    totalMb = Math.round((list.totalBytes / (1024 * 1024)) * 10) / 10;
    freeMb = Math.round((list.freeBytes / (1024 * 1024)) * 10) / 10;
    usedMb = Math.max(0, Math.round((totalMb - freeMb) * 10) / 10);
    percent = Math.min(100, Math.max(1, Math.round((usedMb / totalMb) * 100)));
    remainingSlots = Math.max(0, profile.maxSlots - list.faces.length);
  } else {
    // Predicted calculation
    totalMb = profile.totalMb;
    // Calculate custom faces size using library sizes if known, or profile average
    let calculatedUsedMb = 0;
    for (const face of customFaces) {
      const match = library.find((lib) => lib.id === face.id || lib.title.toLowerCase() === face.name.toLowerCase());
      if (match?.sizeLabel) {
        const kbMatch = match.sizeLabel.match(/(\d+)\s*KB/i);
        if (kbMatch) {
          calculatedUsedMb += parseInt(kbMatch[1], 10) / 1024;
          continue;
        }
      }
      calculatedUsedMb += profile.avgCustomFaceMb;
    }

    usedMb = Math.round(calculatedUsedMb * 10) / 10;
    freeMb = Math.max(0, Math.round((totalMb - usedMb) * 10) / 10);
    percent = Math.min(100, Math.max(customFaces.length > 0 ? 4 : 1, Math.round((usedMb / totalMb) * 100)));
    remainingSlots = Math.max(0, profile.maxSlots - list.faces.length);
  }

  const meterColor =
    percent > 90 ? colors.destructive : percent > 75 ? colors.warning : colors.primary;

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <Ionicons name="hardware-chip-outline" size={18} color={colors.primary} />
          <AppText variant="bodyStrong">
            {hasHardwareTelemetry ? t('faces.storageTitle') : t('faces.storageEstimateTitle')}
          </AppText>
          <View style={[styles.pill, { backgroundColor: colors.muted }]}>
            <AppText
              variant="label"
              color={hasHardwareTelemetry ? colors.primary : colors.mutedForeground}>
              {hasHardwareTelemetry ? t('faces.storageTelemetry') : t('faces.storagePredicted')}
            </AppText>
          </View>
        </View>
        <AppText variant="bodyStrong" style={{ color: colors.foreground }}>
          {usedMb} / {totalMb} MB
        </AppText>
      </View>

      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          style={[styles.bar, { width: `${percent}%`, backgroundColor: meterColor }]}
        />
      </View>

      <View style={styles.footerRow}>
        <AppText variant="caption" muted>
          {t('faces.storageRemaining', { freeMb, slots: remainingSlots })}
        </AppText>
        <AppText variant="caption" muted>
          {t('faces.storageBreakdown', { custom: customFaces.length, factory: factoryFaces.length })}
        </AppText>
      </View>

      <AppText variant="caption" muted style={styles.footnote}>
        {hasHardwareTelemetry
          ? t('faces.storageTelemetryFootnote')
          : t('faces.storageEstimateFootnote')}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  track: {
    height: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginVertical: 2,
  },
  bar: {
    height: '100%',
    borderRadius: radius.pill,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footnote: {
    fontSize: 11,
    lineHeight: 15,
  },
});
