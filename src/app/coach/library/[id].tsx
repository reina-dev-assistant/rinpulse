import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { Card, Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { exerciseById, exerciseImageUrl, exerciseName } from '@/features/coach/exercises';
import { getLocale, useLocale } from '@/i18n';
import { spacing, useTheme } from '@/theme';

/** One exercise: images when there are any, steps, muscles, common mistakes and the credit line. */
export default function ExerciseScreen() {
  const { t } = useTranslation('coach');
  const locale = useLocale();
  const { colors, radius } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const def = id ? exerciseById(id) : undefined;
  const [failed, setFailed] = useState(false);

  if (!def) {
    return (
      <Screen>
        <Notice>{t('library.detail.notFound')}</Notice>
      </Screen>
    );
  }
  const lang = getLocale();
  const images = failed ? 0 : def.images;
  const muscles = (list: readonly string[]) => list.map((m) => t(`muscle.${m as 'abs'}`)).join(', ');

  return (
    <Screen>
      <Card>
        <View style={styles.head}>
          <IconChip icon="barbell" tint="workouts" size="lg" />
          <View style={styles.headText}>
            <AppText variant="heading">{exerciseName(def, lang)}</AppText>
            <AppText variant="caption" muted>
              {`${t(`pattern.${def.pattern}`)} \u00b7 ${t(`equipment.${def.equipment}`)} \u00b7 ${t(`level.${def.level}`)}`}
            </AppText>
          </View>
        </View>
        {images > 0 ? (
          <View style={styles.images}>
            {Array.from({ length: images }, (_, i) => (
              <Image
                key={i}
                source={{ uri: exerciseImageUrl(def.id, i) }}
                style={[styles.image, { borderRadius: radius.input, backgroundColor: colors.muted }]}
                resizeMode="contain"
                accessibilityLabel={exerciseName(def, lang)}
                onError={() => setFailed(true)}
              />
            ))}
          </View>
        ) : (
          <AppText variant="caption" muted>
            {t('library.detail.noImage')}
          </AppText>
        )}
        {def.timed ? (
          <AppText variant="caption" muted>
            {t('library.detail.timed')}
          </AppText>
        ) : null}
      </Card>

      <Section title={t('library.detail.steps')} icon="list" tint="workouts">
        {def.steps[locale].map((step, index) => (
          <AppText key={index} variant="body">{`${index + 1}. ${step}`}</AppText>
        ))}
      </Section>

      <Section title={t('library.detail.muscles')} icon="body" tint="heart">
        <AppText variant="bodyStrong">{t('library.detail.primary')}</AppText>
        <AppText variant="body">{muscles(def.primary)}</AppText>
        {def.secondary.length > 0 ? (
          <>
            <AppText variant="bodyStrong">{t('library.detail.secondary')}</AppText>
            <AppText variant="body">{muscles(def.secondary)}</AppText>
          </>
        ) : null}
      </Section>

      <Section title={t('library.detail.mistakes')} icon="alert-circle" tint="heart">
        {def.mistakes[locale].map((mistake, index) => (
          <AppText key={index} variant="body">{`\u2022 ${mistake}`}</AppText>
        ))}
      </Section>

      <AppText variant="caption" muted>
        {t('library.credits')}
      </AppText>
      <AppText variant="caption" muted>
        {t('disclaimer')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  images: { flexDirection: 'row', gap: spacing.sm },
  image: { flex: 1, aspectRatio: 1 },
});
