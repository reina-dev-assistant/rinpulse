import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useStrengthCloudStatus } from '@/cloud/useStrengthCloudStatus';
import { spacing, useColors } from '@/theme';

/** One caption line on the strength home: where the history is kept (cloud, this phone, waiting to upload, or sign-in needed). */
export function StrengthCloudLine(): ReactElement {
  const { t } = useTranslation('strengthcloud');
  const colors = useColors();
  const { state, pending, offline } = useStrengthCloudStatus();
  const icon =
    state === 'synced'
      ? 'cloud-done-outline'
      : state === 'local-only'
        ? 'phone-portrait-outline'
        : state === 'not-signed-in'
          ? 'log-in-outline'
          : offline
            ? 'cloud-offline-outline'
            : 'cloud-upload-outline';
  const text =
    state === 'synced'
      ? t('status.synced')
      : state === 'local-only'
        ? t('status.localOnly')
        : state === 'not-signed-in'
          ? t('status.notSignedIn')
          : offline
            ? t('status.offline')
            : t('status.pending', { count: pending });
  return (
    <View style={styles.row} accessibilityRole="text">
      <Ionicons name={icon} size={16} color={colors.mutedForeground} />
      <AppText variant="caption" muted style={styles.text}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flex: 1 },
});
