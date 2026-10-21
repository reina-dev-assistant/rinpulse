import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { NavRow } from '@/components/NavRow';
import { Card } from '@/components/Screen';
import { useLoopShortcutDismissed } from '@/features/loops/loopShortcutStore';
import { HIT, useColors } from '@/theme';

/**
 * One quiet row that opens the Loop planner (`/routes/loop`), so it is not only behind Watch > Routes. With `dismissible` (Workouts)
 * it has a close button and stays hidden once closed; Loop is still an option in the Start workout sheet.
 */
export function LoopShortcut({ dismissible = false }: { dismissible?: boolean }) {
  const router = useRouter();
  const { t } = useTranslation('loops');
  const { t: tc } = useTranslation('common');
  const colors = useColors();
  const [dismissed, dismiss] = useLoopShortcutDismissed();
  if (dismissible && dismissed) return null;
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.main}>
          <NavRow icon="repeat" tint="steps" title={t('shortcut.title')} subtitle={t('shortcut.subtitle')} onPress={() => router.push('/routes/loop')} />
        </View>
        {dismissible ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tc('actions.close')} hitSlop={4} onPress={dismiss} style={styles.close}>
            <Ionicons name="close" size={20} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1 },
  close: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
});
