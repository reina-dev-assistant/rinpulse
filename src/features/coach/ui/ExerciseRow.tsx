import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useColors } from '@/theme';
import { exerciseImageUrl } from '../exercises';
import type { ExerciseDef } from '../exercises/types';

const THUMB = 48;

/**
 * One exercise in a list: its first image as a thumbnail (images are white-backed line drawings, shown on a white tile so they
 * read in dark mode too) or, when it has none or the image does not load, the dumbbell icon chip. React Native's image
 * cache keeps a thumbnail once it has loaded.
 */
export function ExerciseRow({ def, title, subtitle, onPress }: { def: ExerciseDef; title: string; subtitle: string; onPress: () => void }) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const showImage = def.images > 0 && !failed;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`} onPress={onPress} scaleTo={0.985} style={styles.row}>
      {showImage ? (
        <View style={styles.tile} accessible={false} importantForAccessibility="no-hide-descendants">
          <Image source={{ uri: exerciseImageUrl(def.id, 0) }} style={styles.thumb} resizeMode="contain" onError={() => setFailed(true)} />
        </View>
      ) : (
        <View style={styles.tile}>
          <IconChip icon="barbell-outline" tint="workouts" size="lg" />
        </View>
      )}
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" muted numberOfLines={2}>
          {subtitle}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tile: { width: THUMB, height: THUMB, alignItems: 'center', justifyContent: 'center', borderRadius: 10, overflow: 'hidden' },
  thumb: { width: THUMB, height: THUMB, backgroundColor: '#ffffff' },
  text: { flex: 1, gap: 1 },
});
