import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { overlay, spacing, useTheme } from '@/theme';

export interface DialogChoice {
  label: string;
  /** `primary` is the answer the dialog recommends: list it first. */
  variant: 'primary' | 'secondary' | 'destructive';
  /** This is the choice being carried out: its button spins. */
  loading?: boolean;
  onPress: () => void;
}

interface ChoiceDialogProps {
  visible: boolean;
  title: string;
  message: string;
  /** In the order shown, top to bottom; the recommended one first. A last "Cancel" button is always added. */
  choices: readonly DialogChoice[];
  cancelLabel?: string;
  /** A choice is being carried out: every button stops answering (the one that was pressed has `loading`). */
  busy?: boolean;
  /** False when the dialog may only be left through a button (no tap outside, no Back): a decision the app cannot go on without. */
  dismissable?: boolean;
  onCancel: () => void;
}

/** `ConfirmDialog` with more than one way forward: a centered card over a dimmed screen, one button per answer and a cancel. */
export function ChoiceDialog({ visible, title, message, choices, cancelLabel, busy, dismissable = true, onCancel }: ChoiceDialogProps) {
  const { t } = useTranslation('common');
  const cancel = cancelLabel ?? t('actions.cancel');
  const { colors, radius } = useTheme();
  const dismiss = dismissable && !busy ? onCancel : () => {};
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={dismiss} accessibilityLabel={dismissable ? cancel : undefined}>
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
            {choices.map((choice) => (
              <Button
                key={choice.label}
                label={choice.label}
                variant={choice.variant}
                lines={2}
                loading={choice.loading}
                disabled={busy}
                onPress={choice.onPress}
              />
            ))}
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
