import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Screen } from '@/components/Screen';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { PhoneSection } from '@/features/settings/PhoneSection';
import { isIos } from '@/components/IosUnavailable';
import { useTheme } from '@/theme';

export default function NotificationsSettingsScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const router = useRouter();
  return (
    <Screen>
      <NotificationsSection />
      <View>
        <NavRow
          icon="apps"
          title={t('index.rows.notificationApps.title')}
          subtitle={isIos ? t('index.rows.notificationApps.subtitleIos') : t('index.rows.notificationApps.subtitle')}
          onPress={() => router.push('/settings/notification-apps')}
          style={groupedRowStyle(theme, 0, 1)}
        />
      </View>
      <PhoneSection />
    </Screen>
  );
}
