import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { LoadingState } from '@/components/States';
import { IconAction } from '@/features/courses/IconAction';
import { formatRouteDistance } from '@/features/routes/routeModel';
import type { RouteCard } from '@/features/routes/routeStore';
import { overlay, spacing, useTheme } from '@/theme';

interface RoutePickerSheetProps {
  visible: boolean;
  cards: RouteCard[] | null;
  selectedId: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
}

/** A bottom sheet of the saved routes; tapping one chooses it for the ride, "Tanpa rute" clears the choice. */
export function RoutePickerSheet({ visible, cards, selectedId, onPick, onClose }: RoutePickerSheetProps) {
  const { t } = useTranslation('bikecomp');
  const { colors, radius } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('route.close')} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <AppText variant="heading" accessibilityRole="header">
                {t('route.pick')}
              </AppText>
              <AppText variant="caption" muted>
                {t('route.sheetCaption')}
              </AppText>
            </View>
            <IconAction icon="close" label={t('route.close')} onPress={onClose} />
          </View>
          {cards === null ? <LoadingState label={t('route.pick')} /> : null}
          {cards !== null && cards.length === 0 ? (
            <AppText variant="caption" muted style={styles.empty}>
              {t('route.empty')}
            </AppText>
          ) : null}
          {cards !== null ? (
            <FlatList
              data={cards}
              style={styles.flat}
              keyExtractor={(card) => card.route.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <PressableScale
                  accessibilityRole="radio"
                  accessibilityState={{ selected: item.route.id === selectedId }}
                  accessibilityLabel={item.route.name}
                  onPress={() => onPick(item.route.id)}
                  scaleTo={0.985}
                  style={styles.row}>
                  <IconChip icon={item.route.id === selectedId ? 'radio-button-on' : 'radio-button-off'} tint={item.route.id === selectedId ? 'link' : 'neutral'} size="md" />
                  <View style={styles.rowText}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {item.route.name}
                    </AppText>
                    <AppText variant="caption" muted numberOfLines={1}>
                      {formatRouteDistance(item.route.distanceM)}
                    </AppText>
                  </View>
                </PressableScale>
              )}
            />
          ) : null}
          {selectedId !== null ? <Button label={t('route.clear')} icon="close-circle-outline" onPress={() => onPick(null)} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: overlay.scrim },
  sheet: { maxHeight: '80%', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerText: { flex: 1, gap: 2 },
  empty: { paddingVertical: spacing.lg },
  flat: { flexShrink: 1 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: 1 },
});
