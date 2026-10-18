import { Ionicons } from '@expo/vector-icons';
import { Modal, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { radius, spacing, useColors } from '@/theme';

export interface CustomDialogState {
  readonly visible: boolean;
  readonly title: string;
  readonly message: string;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly confirmLabel: string;
  readonly confirmVariant?: 'destructive' | 'primary';
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel?: () => void;
}

/** In-app custom confirmation dialog adhering strictly to JoyoFit AMOLED design language. */
export function ThemedDialog({ dialog, onClose }: { dialog: CustomDialogState | null; onClose: () => void }) {
  const colors = useColors();
  if (!dialog || !dialog.visible) return null;

  const handleConfirm = () => {
    dialog.onConfirm();
    onClose();
  };

  const handleCancel = () => {
    if (dialog.onCancel) {
      dialog.onCancel();
    }
    onClose();
  };

  return (
    <Modal visible={dialog.visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.dialogOverlay}>
        <View style={[styles.dialogCard, { backgroundColor: colors.card, borderColor: colors.hairline }]}>
          {dialog.icon ? (
            <View
              style={[
                styles.dialogIconWrap,
                {
                  backgroundColor: dialog.confirmVariant === 'destructive' ? 'rgba(239, 68, 68, 0.15)' : colors.muted,
                },
              ]}>
              <Ionicons
                name={dialog.icon}
                size={32}
                color={dialog.confirmVariant === 'destructive' ? colors.destructive : colors.primary}
              />
            </View>
          ) : null}
          <AppText variant="heading" style={styles.dialogTitle}>
            {dialog.title}
          </AppText>
          <AppText variant="caption" muted style={styles.dialogMessage}>
            {dialog.message}
          </AppText>
          <View style={styles.dialogActions}>
            {dialog.cancelLabel ? (
              <Button label={dialog.cancelLabel} variant="secondary" style={{ flex: 1 }} onPress={handleCancel} />
            ) : null}
            <Button
              label={dialog.confirmLabel}
              variant={dialog.confirmVariant ?? 'primary'}
              style={{ flex: 1 }}
              onPress={handleConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    borderWidth: 1.5,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  dialogIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  dialogTitle: {
    textAlign: 'center',
  },
  dialogMessage: {
    textAlign: 'center',
    lineHeight: 22,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
    marginTop: spacing.sm,
  },
});
