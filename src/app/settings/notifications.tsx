import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Screen } from '@/components/Screen';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { PhoneSection } from '@/features/settings/PhoneSection';
import { isIos } from '@/components/IosUnavailable';
import { quickRepliesSupport } from '@/features/settings/quickReplies';
import { useWatch } from '@/state/WatchProvider';
import { useTheme } from '@/theme';
import { hasNative } from '@/wear';

export default function NotificationsSettingsScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const router = useRouter();
  const { linkState } = useWatch();
  // Only a connected watch that takes quick replies; re-read when the link changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `linkState` is the trigger, the native read has no inputs
  const quickReplies = useMemo(() => quickRepliesSupport().supported, [linkState]);
  return (
    <Screen>
      <NotificationsSection />
      <View>
        <NavRow
          icon="apps"
          title={t('index.rows.notificationApps.title')}
          subtitle={isIos ? t(hasNative('getNotificationFilter') ? 'index.rows.notificationApps.subtitleIosFilter' : 'index.rows.notificationApps.subtitleIos') : t('index.rows.notificationApps.subtitle')}
          onPress={() => router.push('/settings/notification-apps')}
          style={groupedRowStyle(theme, 0, 1)}
        />
      </View>
      {quickReplies ? (
        <View>
          <NavRow
            icon="chatbubble-ellipses"
            title={t('quickReplies.rowTitle')}
            subtitle={t('quickReplies.rowSubtitle')}
            onPress={() => router.push('/settings/quick-replies')}
            style={groupedRowStyle(theme, 0, 1)}
          />
        </View>
      ) : null}
      <PhoneSection />
    </Screen>
  );
}
