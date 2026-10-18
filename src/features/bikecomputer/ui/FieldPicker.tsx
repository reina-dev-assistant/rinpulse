import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { useLocale } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import type { FieldId } from '../types';
import { FIELD_GROUPS } from './fieldGroups';
import { sampleContext, sampleFieldValue } from './fieldSamples';

interface FieldPickerProps {
  visible: boolean;
  /** The field in the slot being changed; marked in the list. */
  current: FieldId | null;
  onPick: (id: FieldId) => void;
  onClose: () => void;
}

/** A full-screen list of every data field, grouped by family: name, an example value and what it measures. */
export function FieldPicker({ visible, current, onPick, onClose }: FieldPickerProps) {
  const { t } = useTranslation('bikecomp');
  const { colors, fonts, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const locale = useLocale();
  const sections = useMemo(() => {
    const ctx = sampleContext();
    return FIELD_GROUPS.map((group) => ({
      key: group.key,
      title: t(`picker.group.${group.key}`),
      data: group.fields.map((id) => {
        const sample = sampleFieldValue(id, ctx);
        return {
          id,
          name: t(`field.${id}.name`),
          desc: t(`field.${id}.desc`),
          example: sample.unit ? `${sample.value} ${sample.unit}` : sample.value,
        };
      }),
    }));
    // The language changes the names and the formatted examples.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, locale]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="title" accessibilityRole="header" style={styles.title}>
            {t('picker.title')}
          </AppText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('picker.close')}
            onPress={onClose}
            style={[styles.close, { backgroundColor: colors.muted, borderRadius: radius.control }]}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </PressableScale>
        </View>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
          renderSectionHeader={({ section }) => (
            <AppText variant="heading" accessibilityRole="header" style={styles.group}>
              {section.title}
            </AppText>
          )}
          renderItem={({ item, index, section }) => {
            const selected = item.id === current;
            return (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t('picker.rowA11y', { name: item.name, desc: item.desc })}
                accessibilityState={{ selected }}
                onPress={() => onPick(item.id)}
                scaleTo={0.985}
                style={[
                  styles.row,
                  { backgroundColor: colors.card, borderBottomColor: colors.hairline },
                  index === 0 && { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
                  index === section.data.length - 1 && { borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card },
                  index < section.data.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth },
                ]}>
                <View style={styles.rowText}>
                  <AppText variant="bodyStrong">{item.name}</AppText>
                  <AppText variant="caption" muted>
                    {item.desc}
                  </AppText>
                </View>
                <View style={styles.example}>
                  <AppText numberOfLines={1} style={{ fontFamily: fonts.heavy, fontSize: 18, fontVariant: ['tabular-nums'] }}>
                    {item.example}
                  </AppText>
                  {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                </View>
              </PressableScale>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  title: { flex: 1 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  group: { paddingTop: spacing.lg, paddingBottom: spacing.sm },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: 1 },
  example: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: 140 },
});
