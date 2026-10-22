import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { HIT, spacing, useColors } from '@/theme';

interface RadioRowProps {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}

/** One choice of a single-choice list: the circle shows which one is in use, the line under the title says what it means. */
export function RadioRow({ title, subtitle, selected, onPress }: RadioRowProps) {
  const colors = useColors();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityState={{ selected }}
      onPress={onPress}
      scaleTo={0.985}
      style={styles.row}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.mutedForeground} />
      <View style={styles.text}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" muted>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: HIT + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  text: { flex: 1, gap: 1 },
});
