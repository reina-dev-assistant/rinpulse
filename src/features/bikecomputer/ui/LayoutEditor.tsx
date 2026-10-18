import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useLocale } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import { addPage, defaultLayout, movePage, removePage, setGrid, setSlot } from '../fields/layout';
import { bikeSettingsStore } from '../settings';
import { GRID_SIZES, MAX_PAGES, type BikeLayout, type FieldId, type GridSize, type RidePage } from '../types';
import { FieldGrid } from './FieldGrid';
import { FieldPicker } from './FieldPicker';
import { sampleContext, sampleFieldValue } from './fieldSamples';
import { resolveRideTheme, ridePalette } from './ridePalette';
import { useBikeLayout, useBikeSettings } from './useBikeSettings';

interface LayoutEditorProps {
  visible: boolean;
  onClose: () => void;
}

const ADD_KINDS: readonly RidePage['kind'][] = ['fields', 'map', 'climb', 'laps'];

function IconButton({ icon, label, disabled, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; disabled?: boolean; onPress: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.96}
      style={[styles.iconButton, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
      <Ionicons name={icon} size={22} color={colors.foreground} />
    </PressableScale>
  );
}

/**
 * Edits the pages of the ride screen: order, add, remove, how many numbers a page has, and which number sits in each slot (a tap on the
 * preview opens the field picker). Every change is saved at once through `bikeSettingsStore.setLayout`.
 */
export function LayoutEditor({ visible, onClose }: LayoutEditorProps) {
  const { t } = useTranslation('bikecomp');
  const { scheme, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useBikeLayout();
  const settings = useBikeSettings();
  const locale = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [slot, setSlot_] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const palette = ridePalette(resolveRideTheme(settings.theme, scheme));
  const sample = useMemo(() => sampleContext(), []);
  const selected = layout.pages.find((p) => p.id === selectedId) ?? layout.pages[0] ?? null;
  const picking = selected?.kind === 'fields' && slot !== null ? selected : null;

  const apply = (next: BikeLayout) => bikeSettingsStore.setLayout(next);
  const atLimit = layout.pages.length >= MAX_PAGES;
  const gridOptions = GRID_SIZES.map((size) => ({ value: size, label: String(size) }));

  const kindLabel = (page: RidePage): string => (page.kind === 'fields' ? t('editor.kind.fields', { count: page.grid }) : t(`editor.kind.${page.kind}`));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="title" accessibilityRole="header" style={styles.title}>
            {t('editor.title')}
          </AppText>
          <IconButton icon="close" label={t('picker.close')} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          {layout.pages.map((page, index) => {
            const open = selected?.id === page.id;
            return (
              <Card key={page.id}>
                <View style={styles.pageRow}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`${t('editor.edit', { n: index + 1 })}. ${kindLabel(page)}`}
                    accessibilityState={{ expanded: open }}
                    onPress={() => setSelectedId(page.id)}
                    scaleTo={0.985}
                    style={styles.pageTitle}>
                    <View style={styles.pageText}>
                      <AppText variant="bodyStrong">{t('editor.pageTitle', { n: index + 1 })}</AppText>
                      <AppText variant="caption" muted>
                        {kindLabel(page)}
                      </AppText>
                    </View>
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
                  </PressableScale>
                  <IconButton icon="arrow-up" label={t('editor.moveUp', { n: index + 1 })} disabled={index === 0} onPress={() => apply(movePage(layout, page.id, -1))} />
                  <IconButton
                    icon="arrow-down"
                    label={t('editor.moveDown', { n: index + 1 })}
                    disabled={index === layout.pages.length - 1}
                    onPress={() => apply(movePage(layout, page.id, 1))}
                  />
                  <IconButton
                    icon="trash-outline"
                    label={t('editor.remove', { n: index + 1 })}
                    disabled={layout.pages.length <= 1}
                    onPress={() => apply(removePage(layout, page.id))}
                  />
                </View>

                {open && page.kind === 'fields' ? (
                  <View style={styles.detail}>
                    <AppText variant="label">{t('editor.gridLabel')}</AppText>
                    <Segmented<GridSize> options={gridOptions} value={page.grid} onChange={(grid) => apply(setGrid(layout, page.id, grid))} />
                    <View style={styles.previewHead}>
                      <AppText variant="label">{t('editor.preview')}</AppText>
                      <AppText variant="caption" muted style={styles.previewNote}>
                        {t('editor.previewNote')}
                      </AppText>
                    </View>
                    <View style={[styles.preview, { borderColor: colors.hairline }]}>
                      <FieldGrid
                        fields={page.fields}
                        grid={page.grid}
                        palette={palette}
                        resolve={(id: FieldId) => sampleFieldValue(id, sample)}
                        onSlotPress={(index_) => setSlot_(index_)}
                        key={`${page.id}-${page.grid}-${locale}`}
                      />
                    </View>
                    <AppText variant="caption" muted>
                      {t('editor.slotHint')}
                    </AppText>
                  </View>
                ) : null}
                {open && page.kind !== 'fields' ? (
                  <AppText variant="caption" muted style={styles.detail}>
                    {t(`editor.specialNote.${page.kind}`)}
                  </AppText>
                ) : null}
              </Card>
            );
          })}

          <Card>
            <AppText variant="bodyStrong">{t('editor.add')}</AppText>
            <View style={styles.addRow}>
              {ADD_KINDS.map((kind) => {
                const taken = kind !== 'fields' && layout.pages.some((p) => p.kind === kind);
                return (
                  <Button
                    key={kind}
                    label={t(`editor.addKind.${kind}`)}
                    icon="add"
                    disabled={atLimit || taken}
                    style={styles.addButton}
                    onPress={() => {
                      const next = addPage(layout, kind);
                      apply(next);
                      const added = next.pages[next.pages.length - 1];
                      if (added && next.pages.length > layout.pages.length) setSelectedId(added.id);
                    }}
                  />
                );
              })}
            </View>
            {atLimit ? <Notice>{t('editor.maxPages', { count: MAX_PAGES })}</Notice> : null}
          </Card>

          <Button label={t('editor.reset')} variant="destructive" icon="refresh" onPress={() => setConfirmReset(true)} />
        </ScrollView>
      </View>

      <FieldPicker
        visible={picking !== null}
        current={picking && slot !== null ? (picking.fields[slot] ?? null) : null}
        onClose={() => setSlot_(null)}
        onPick={(id) => {
          if (picking && slot !== null) apply(setSlot(layout, picking.id, slot, id));
          setSlot_(null);
        }}
      />
      <ConfirmDialog
        visible={confirmReset}
        title={t('editor.resetTitle')}
        message={t('editor.resetMessage')}
        confirmLabel={t('editor.reset')}
        destructive
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          apply(defaultLayout(false));
          setSelectedId(null);
          setConfirmReset(false);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  title: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pageTitle: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pageText: { flex: 1, gap: 1 },
  detail: { gap: spacing.sm, paddingTop: spacing.sm },
  previewHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  previewNote: { flex: 1 },
  preview: { width: '92%', aspectRatio: 0.72, alignSelf: 'center', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addButton: { flexGrow: 1 },
});
