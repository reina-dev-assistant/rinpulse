import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useSessionHeaders } from '@/features/social/useSessionHeaders';
import { spacing, useTheme } from '@/theme';

/** A picture from JoyoRogo that needs the session (a comment photo), in a fixed box; a failed load says so instead of staying blank. */
export function AuthImage({
  uri,
  label,
  aspectRatio = 4 / 3,
  session = true,
}: {
  uri: string;
  label: string;
  aspectRatio?: number;
  /** False for a picture on the phone (a photo picked but not sent yet): no cookie needed. */
  session?: boolean;
}) {
  const { t } = useTranslation('social');
  const { colors, radius } = useTheme();
  const sessionHeaders = useSessionHeaders();
  const headers = session ? sessionHeaders : {};
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.box, { aspectRatio, backgroundColor: colors.muted, borderRadius: radius.control }]}>
      {failed ? (
        <AppText variant="caption" muted style={styles.failed}>
          {t('comments.photoFailed')}
        </AppText>
      ) : headers ? (
        <Image
          source={{ uri, headers }}
          accessibilityLabel={label}
          resizeMode="cover"
          style={styles.image}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', maxWidth: 320, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  failed: { padding: spacing.md, textAlign: 'center' },
});
