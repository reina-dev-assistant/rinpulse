import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { exerciseImageUrl } from '@/features/coach/exercises';
import { useLocale } from '@/i18n';
import { spacing, useColors } from '@/theme';

import type { CatalogExercise } from '../catalog';
import { BottomSheet } from './Sheet';

interface ExerciseInfoSheetProps {
  exercise: CatalogExercise | null;
  name: string;
  onClose: () => void;
}

/** Steps, common mistakes and pictures of a library exercise; an exercise of the person's own only has its muscles. */
export function ExerciseInfoSheet({ exercise, name, onClose }: ExerciseInfoSheetProps) {
  const { t } = useTranslation(['strength', 'coach']);
  const locale = useLocale();
  const colors = useColors();
  const def = exercise?.def ?? null;
  const muscles = exercise ? [...exercise.primary, ...exercise.secondary] : [];
  return (
    <BottomSheet visible={exercise !== null} onClose={onClose} title={name}>
      {exercise ? (
        <View style={styles.body}>
          {def && def.images > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.images}>
              {Array.from({ length: def.images }, (_, i) => (
                <Image
                  key={i}
                  accessibilityIgnoresInvertColors
                  source={{ uri: exerciseImageUrl(def.id, i) }}
                  style={[styles.image, { backgroundColor: colors.muted }]}
                  resizeMode="contain"
                />
              ))}
            </ScrollView>
          ) : null}
          <AppText variant="caption" muted>
            {t('strength:info.equipment', { equipment: t(`coach:equipment.${exercise.equipment}`) })}
          </AppText>
          {muscles.length > 0 ? (
            <View style={styles.block}>
              <AppText variant="label" muted>
                {t('strength:info.muscles')}
              </AppText>
              <AppText variant="body">
                {exercise.primary.map((m) => t(`coach:muscle.${m}`)).join(', ')}
                {exercise.secondary.length > 0 ? ` (${exercise.secondary.map((m) => t(`coach:muscle.${m}`)).join(', ')})` : ''}
              </AppText>
            </View>
          ) : null}
          {def && def.steps[locale].length > 0 ? (
            <View style={styles.block}>
              <AppText variant="label" muted>
                {t('strength:info.steps')}
              </AppText>
              {def.steps[locale].map((step, i) => (
                <View key={i} style={styles.line}>
                  <AppText variant="bodyStrong" style={styles.marker}>
                    {i + 1}
                  </AppText>
                  <AppText variant="body" style={styles.lineText}>
                    {step}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
          {def && def.mistakes[locale].length > 0 ? (
            <View style={styles.block}>
              <AppText variant="label" muted>
                {t('strength:info.mistakes')}
              </AppText>
              {def.mistakes[locale].map((mistake, i) => (
                <View key={i} style={styles.line}>
                  <AppText variant="bodyStrong" style={styles.marker}>
                    -
                  </AppText>
                  <AppText variant="body" style={styles.lineText}>
                    {mistake}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
          {!def ? (
            <AppText variant="caption" muted>
              {t('strength:info.custom')}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  images: { gap: spacing.sm },
  image: { width: 240, height: 180, borderRadius: 12 },
  block: { gap: spacing.xs },
  line: { flexDirection: 'row', gap: spacing.sm },
  marker: { width: 20 },
  lineText: { flex: 1 },
});
