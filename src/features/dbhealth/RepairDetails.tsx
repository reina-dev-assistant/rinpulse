import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { repairLogLines } from '@/db/recovery/repairLog';

/** How many lines of the repair log the failed notice shows. */
const LINES = 14;

/**
 * The technical side of a failed repair, as plain selectable text: the error that stopped it and the last steps of the repair
 * log. Not translated on purpose: it is what a person copies into a message to support when the repair does not work and the
 * phone is not connected to anything that could read its log.
 */
export function RepairDetails({ reason }: { reason: string | null }) {
  const lines = repairLogLines(LINES);
  if (reason === null && lines.length === 0) return null;
  return (
    <View style={styles.box}>
      {reason !== null ? (
        <AppText variant="caption" selectable>
          {reason}
        </AppText>
      ) : null}
      {lines.map((line, index) => (
        <AppText key={index} variant="caption" muted selectable style={styles.mono}>
          {line}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 2, maxWidth: '100%' },
  mono: { fontSize: 11, lineHeight: 15 },
});
