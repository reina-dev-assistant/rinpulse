import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import type { WatchfaceItem } from '@/features/watchfaces/watchfaceModel';
import { radius, spacing, useColors } from '@/theme';
import type { WatchfaceInfo, WatchfaceList } from '@/wear';

interface WatchfacePreviewModalProps {
  readonly previewFace: WatchfaceItem | null;
  readonly list: WatchfaceList | null;
  readonly tab: 'installed' | 'library';
  readonly connected: boolean;
  readonly idle: boolean;
  readonly installing: boolean;
  readonly installingUrl: string | null;
  readonly matchedFace?: WatchfaceInfo;
  readonly onClose: () => void;
  readonly onInstall: (face: WatchfaceItem) => Promise<void>;
  readonly onSetActive: (id: string) => void;
}

/** Full-screen bottom-sheet modal displaying watchface art in realistic chassis with hardware actions. */
export function WatchfacePreviewModal({
  previewFace,
  list,
  tab,
  connected,
  idle,
  installing,
  installingUrl,
  matchedFace,
  onClose,
  onInstall,
  onSetActive,
}: WatchfacePreviewModalProps) {
  const { t } = useTranslation(['watch', 'common']);
  const colors = useColors();
  if (!previewFace) return null;

  const isRound =
    previewFace.category.startsWith('Round') ||
    (previewFace.width >= 450 && previewFace.width === previewFace.height);
  const isFit =
    previewFace.category.startsWith('Fit') || previewFace.width === 408 || previewFace.width === 336;

  const targetW = list?.width;
  const targetH = list?.height;
  const isWrongResolution =
    Boolean(targetW && targetH) && (previewFace.width !== targetW || previewFace.height !== targetH);
  const isModalInstalling = installing && installingUrl === previewFace.downloadUrl;

  const renderActionButton = () => {
    if (matchedFace?.active) {
      return <Button label={t('watch:faces.activeOnWrist')} icon="checkmark-circle" variant="secondary" disabled onPress={() => {}} />;
    }

    if (matchedFace) {
      return (
        <Button
          label={t('watch:faces.setActive')}
          icon="checkmark-circle-outline"
          variant="primary"
          disabled={!connected || !idle}
          onPress={() => {
            onSetActive(matchedFace.id);
            onClose();
          }}
        />
      );
    }

    if (isWrongResolution) {
      return (
        <Button
          label={t('watch:faces.incompatibleResolution', { width: previewFace.width, height: previewFace.height })}
          icon="alert-circle-outline"
          variant="secondary"
          disabled
          onPress={() => {}}
        />
      );
    }

    return (
      <Button
        label={isModalInstalling ? t('watch:faces.installingToWatch') : t('watch:faces.installToWatch')}
        icon="cloud-download-outline"
        variant="primary"
        disabled={!connected || !idle || isModalInstalling}
        loading={isModalInstalling}
        onPress={() => {
          void onInstall(previewFace).then(() => {
            onClose();
          });
        }}
      />
    );
  };

  return (
    <Modal visible={previewFace !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          <View style={styles.modalHeader}>
            <View style={styles.titleRow}>
              <IconChip icon="watch" size="sm" />
              <AppText variant="heading" numberOfLines={1} style={{ flex: 1 }}>
                {previewFace.title}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common:actions.close')}
              onPress={onClose}
              hitSlop={12}
              style={styles.modalCloseBtn}>
              <Ionicons name="close-circle" size={28} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={styles.modalPreviewArea}>
            <View
              style={[
                styles.modalChassisBase,
                isRound ? styles.modalChassisRound : isFit ? styles.modalChassisFit : styles.modalChassisBand,
              ]}>
              {previewFace.previewUrl ? (
                <Image source={{ uri: previewFace.previewUrl }} style={styles.fillImage} resizeMode="contain" />
              ) : (
                <View style={styles.emptyPreviewFrame}>
                  <Ionicons name="watch-outline" size={48} color={colors.mutedForeground} />
                  <AppText variant="caption" muted style={{ marginTop: spacing.xs }}>
                    {t('watch:faces.noPreview')}
                  </AppText>
                </View>
              )}
            </View>
          </View>

          <View style={styles.modalMeta}>
            <View style={styles.modalMetaRow}>
              <AppText variant="caption" muted>
                Author: {previewFace.author}
              </AppText>
              <AppText variant="caption" muted>
                Format: {previewFace.sizeLabel}
              </AppText>
            </View>
            <View style={styles.modalMetaRow}>
              <AppText variant="caption" muted>
                Resolution: {previewFace.width}x{previewFace.height} px
              </AppText>
              {tab === 'library' && !matchedFace ? (
                <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                  <AppText variant="label" color={isWrongResolution ? colors.destructive : colors.primary}>
                    {isWrongResolution ? 'Incompatible' : 'Matches screen'}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" style={{ marginTop: spacing.xs }}>
              {previewFace.description}
            </AppText>
          </View>

          {previewFace.downloadUrl || matchedFace ? (
            <View style={styles.modalActions}>{renderActionButton()}</View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.xl,
    gap: spacing.lg,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  modalCloseBtn: {
    padding: spacing.xs,
  },
  modalPreviewArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  modalChassisBase: {
    backgroundColor: '#050505',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  modalChassisBand: {
    width: 140,
    height: 240,
    borderRadius: 28,
  },
  modalChassisRound: {
    width: 220,
    height: 220,
    borderRadius: 110,
  },
  modalChassisFit: {
    width: 170,
    height: 220,
    borderRadius: 24,
  },
  emptyPreviewFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fillImage: {
    width: '100%',
    height: '100%',
  },
  modalMeta: {
    gap: spacing.xs,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  modalActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
