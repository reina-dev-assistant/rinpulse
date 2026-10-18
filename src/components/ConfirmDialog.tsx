import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { overlay, spacing, useTheme } from '@/theme';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button, for a decision that deletes something or signs out. */
  destructive?: boolean;
  /** The decision is being carried out: the confirm button spins and both buttons stop answering. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A centered card over a dimmed screen for one decision that cannot be undone silently. Back or a tap outside cancels. */
export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel, destructive, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  const cancel = cancelLabel ?? t('actions.cancel');
  const { colors, radius } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={cancel}>
        {/* A press on the card itself must not reach the scrim. */}
        <Pressable
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radius.card }]}
          onPress={() => {}}>
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          <AppText variant="body">{message}</AppText>
          <View style={styles.actions}>
            <Button label={confirmLabel} variant={destructive ? 'destructive' : 'primary'} loading={busy} onPress={onConfirm} />
            <Button label={cancel} disabled={busy} onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'center', padding: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
