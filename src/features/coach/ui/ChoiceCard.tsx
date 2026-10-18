import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useTheme } from '@/theme';

/** A single choice with a title and a hint; the selected one is outlined in the primary color. Radio semantics for screen readers. */
export function ChoiceCard({ title, hint, selected, onPress }: { title: string; hint?: string; selected: boolean; onPress: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
      accessibilityState={{ selected }}
      onPress={onPress}
      scaleTo={0.985}
      style={[styles.card, { backgroundColor: selected ? colors.muted : colors.card, borderRadius: radius.card, borderColor: selected ? colors.primary : colors.hairline }]}>
      <View style={styles.text}>
        <AppText variant="bodyStrong">{title}</AppText>
        {hint ? (
          <AppText variant="caption" muted>
            {hint}
          </AppText>
        ) : null}
      </View>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.mutedForeground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 2 },
  text: { flex: 1, flexShrink: 1, gap: 2 },
});
