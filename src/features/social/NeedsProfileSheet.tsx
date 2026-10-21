import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ROGO_ONBOARDING_APP_URL, ROGO_ONBOARDING_WEB_URL } from '@/features/social/shareError';
import { spacing, useColors } from '@/theme';

/** Opens JoyoRogo's onboarding: the app when it is installed, else the web page. */
export async function openRogoOnboarding(): Promise<void> {
  try {
    await Linking.openURL(ROGO_ONBOARDING_APP_URL);
  } catch {
    await Linking.openURL(ROGO_ONBOARDING_WEB_URL);
  }
}

/** Shown when JoyoRogo refuses a social write because the account has no profile yet. */
export function NeedsProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation('social');
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('share.needsProfile.later')} />
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <AppText variant="heading" accessibilityRole="header">
          {t('share.needsProfile.title')}
        </AppText>
        <AppText>{t('share.needsProfile.body')}</AppText>
        <Button
          label={t('share.needsProfile.open')}
          variant="primary"
          icon="open-outline"
          onPress={() => {
            onClose();
            void openRogoOnboarding().catch(() => {});
          }}
        />
        <Button label={t('share.needsProfile.later')} onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { padding: spacing.lg, gap: spacing.md, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
});
