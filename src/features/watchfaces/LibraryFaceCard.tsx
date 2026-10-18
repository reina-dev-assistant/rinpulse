import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Screen';
import { ActivePill, WatchThumbnail } from '@/features/watchfaces/WatchThumbnail';
import type { WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import type { DownloadedFace } from '@/features/watchfaces/useWatchfaceLibrary';
import type { WatchfaceBusy } from '@/features/watchfaces/useWatchfaces';
import { radius, spacing, useColors } from '@/theme';
import type { WatchfaceInfo } from '@/wear';

interface LibraryFaceCardProps {
  readonly face: DownloadedFace;
  readonly matchedWatchFace?: WatchfaceInfo;
  readonly screenWidth?: number | null;
  readonly screenHeight?: number | null;
  readonly busy: WatchfaceBusy;
  readonly connected: boolean;
  readonly idle: boolean;
  readonly installing: boolean;
  readonly installingUrl: string | null;
  readonly onPreview: (face: WatchfaceItem) => void;
  readonly onSetActive: (id: string) => void;
  readonly onInstall: (face: WatchfaceItem) => Promise<void>;
  readonly onDelete: (face: DownloadedFace) => void;
}

/** Card rendering an item from the phone's personal offline watch face library. */
export const LibraryFaceCard = memo(function LibraryFaceCard({
  face,
  matchedWatchFace,
  screenWidth,
  screenHeight,
  busy,
  connected,
  idle,
  installing,
  installingUrl,
  onPreview,
  onSetActive,
  onInstall,
  onDelete,
}: LibraryFaceCardProps) {
  const { t } = useTranslation(['watch', 'common']);
  const colors = useColors();
  const onWatch = Boolean(matchedWatchFace);
  const isActive = matchedWatchFace?.active ?? false;
  const isCurrentInstalling = installing && installingUrl === face.downloadUrl;
  const working =
    typeof busy === 'object' && busy !== null && matchedWatchFace && busy.id === matchedWatchFace.id;
  const action = typeof busy === 'object' && busy !== null ? busy.action : null;

  const hasWatchScreen = Boolean(screenWidth && screenHeight);
  const isWrongResolution =
    hasWatchScreen && (face.width !== screenWidth || face.height !== screenHeight);

  const renderActionButton = () => {
    if (onWatch) {
      if (isActive) {
        return (
          <Button
            label={t('watch:faces.active')}
            icon="checkmark-circle"
            variant="secondary"
            disabled
            style={styles.actionBtn}
            onPress={() => {}}
          />
        );
      }
      if (matchedWatchFace) {
        return (
          <Button
            label={t('watch:faces.setActive')}
            icon="checkmark-circle-outline"
            variant="primary"
            disabled={!connected || !idle}
            loading={working && action === 'activate'}
            style={styles.actionBtn}
            onPress={() => onSetActive(matchedWatchFace.id)}
          />
        );
      }
      return (
        <Button
          label={t('watch:faces.installed')}
          icon="checkmark-circle"
          variant="secondary"
          disabled
          style={styles.actionBtn}
          onPress={() => {}}
        />
      );
    }

    if (isWrongResolution) {
      return (
        <Button
          label={t('watch:faces.wrongSize')}
          icon="alert-circle-outline"
          variant="secondary"
          disabled
          style={styles.actionBtn}
          onPress={() => {}}
        />
      );
    }

    return (
      <Button
        label={
          isCurrentInstalling
            ? t('watch:faces.installingToWatch')
            : !face.downloadUrl
              ? t('watch:faces.missingFile')
              : t('watch:faces.installAction')
        }
        icon="cloud-upload-outline"
        variant="primary"
        disabled={!connected || !idle || isCurrentInstalling || !face.downloadUrl}
        loading={isCurrentInstalling}
        style={styles.actionBtn}
        onPress={() => void onInstall(face)}
      />
    );
  };

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Preview ${face.title}`}
        onPress={() => onPreview(face)}
        style={styles.cardHeaderPressable}>
        <WatchThumbnail face={face} active={isActive} />
        <View style={styles.faceText}>
          <View style={styles.titleLine}>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {face.title}
            </AppText>
            {isActive ? (
              <ActivePill />
            ) : onWatch ? (
              <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                <AppText variant="label" color={colors.primary}>
                  {t('watch:faces.installedOnWatch')}
                </AppText>
              </View>
            ) : !hasWatchScreen ? null : isWrongResolution ? (
              <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                <AppText variant="label" color={colors.destructive}>
                  {t('watch:faces.incompatible')}
                </AppText>
              </View>
            ) : (
              <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                <AppText variant="label" color={colors.mutedForeground}>
                  {t('watch:faces.matchesScreen')}
                </AppText>
              </View>
            )}
          </View>
          <AppText variant="caption" muted>
            {t('watch:faces.byAuthor', { author: face.author })}
          </AppText>
          <AppText variant="caption" muted>
            {face.width > 0 && face.height > 0
              ? `${face.width}×${face.height} px`
              : t('watch:faces.unknownResolution')}
            {' · '}
            {face.sizeLabel}
          </AppText>
        </View>
      </Pressable>
      <AppText variant="caption">{face.description}</AppText>
      <View style={styles.actions}>
        {renderActionButton()}
        <Button
          label={t('common:actions.delete')}
          icon="trash-outline"
          variant="destructive"
          style={styles.deleteBtn}
          onPress={() => onDelete(face)}
        />
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  cardHeaderPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  faceText: {
    flex: 1,
    gap: 2,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1.3,
  },
  deleteBtn: {
    flex: 1,
  },
});
