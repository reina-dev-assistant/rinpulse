import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { initialRouteName: 'index' };

export default function WatchLayout() {
  const { t } = useTranslation('watch');
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="alarms" options={{ title: t('screens.alarms') }} />
      <Stack.Screen name="faces" options={{ title: t('screens.faces') }} />
      <Stack.Screen name="face-edit" options={{ title: t('screens.faceEdit') }} />
      <Stack.Screen name="photos" options={{ title: t('screens.photo') }} />
      <Stack.Screen name="sensors" options={{ title: t('screens.sensors') }} />
    </Stack>
  );
}
