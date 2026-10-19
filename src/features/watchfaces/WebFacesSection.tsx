import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { fmtDate } from '@/i18n';
import {
  formatFaceSize,
  isWebFaceInstalled,
  webInstallBlock,
  type WebFace,
  type WebLibraryState,
} from '@/features/watchfaces/webLibraryModel';
import { spacing } from '@/theme';
import type { WatchfaceInfo } from '@/wear';

interface WebFacesSectionProps {
  readonly state: WebLibraryState;
  readonly faces: readonly WebFace[];
  readonly installedFaces: readonly WatchfaceInfo[] | undefined;
  readonly connected: boolean;
  readonly idle: boolean;
  readonly downloadingId: string | null;
  readonly downloadError: string | null;
  readonly onRetry: () => void;
  readonly onInstall: (face: WebFace) => void;
}

/** "Dari web": the account's web library with one install button per face. */
export function WebFacesSection({
  state,
  faces,
  installedFaces,
  connected,
  idle,
  downloadingId,
  downloadError,
  onRetry,
  onInstall,
}: WebFacesSectionProps) {
  const { t } = useTranslation('watch');
  const router = useRouter();
  const goAccount = () => router.push('/settings/akun');

  return (
    <Section title={t('faces.web.title')} icon="cloud-download-outline">
      <AppText variant="caption">{t('faces.web.hint')}</AppText>
      {state === 'notConfigured' ? (
        <Notice icon="cloud-offline-outline">{t('faces.web.notConfigured')}</Notice>
      ) : state === 'signedOut' ? (
        <Notice icon="log-in-outline" action={{ label: t('faces.web.openAccount'), onPress: goAccount }}>
          {t('faces.web.signedOut')}
        </Notice>
      ) : state === 'loading' ? (
        <AppText variant="caption" muted>
          {t('faces.web.loading')}
        </AppText>
      ) : state === 'error' ? (
        <Notice tone="danger" action={{ label: t('faces.web.retry'), onPress: onRetry }}>
          {t('faces.web.error')}
        </Notice>
      ) : state === 'empty' ? (
        <Notice icon="cloud-upload-outline">{t('faces.web.empty')}</Notice>
      ) : (
        <View style={styles.list}>
          {faces.map((face) => {
            const installed = isWebFaceInstalled(face, installedFaces);
            const working = downloadingId === face.id;
            const block = webInstallBlock({ connected, idle: idle && downloadingId === null, installed });
            return (
              <View key={face.id} style={styles.row}>
                <View style={styles.info}>
                  <AppText variant="body" numberOfLines={1}>
                    {face.name}
                  </AppText>
                  <AppText variant="caption" muted>
                    {[formatFaceSize(face.size), face.createdAt > 0 ? fmtDate(face.createdAt, 'short') : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                  {block === 'notConnected' ? (
                    <AppText variant="caption" muted>
                      {t('faces.web.needsWatch')}
                    </AppText>
                  ) : null}
                </View>
                <Button
                  label={installed ? t('faces.installed') : t('faces.web.install')}
                  icon={installed ? 'checkmark-circle' : 'download-outline'}
                  variant={installed ? 'secondary' : 'primary'}
                  loading={working}
                  disabled={block !== null}
                  onPress={() => onInstall(face)}
                />
              </View>
            );
          })}
        </View>
      )}
      {downloadError ? <Notice tone="danger">{t('faces.web.downloadFailed', { error: downloadError })}</Notice> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: 2 },
});
