import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { CloudSection } from '@/features/settings/CloudSection';
import { ProfilePhoto } from '@/features/settings/ProfilePhoto';

/** The JoyoRogo account: its profile photo and its cloud sync. Signing out and deleting the account are the last rows of the Settings hub. */
export default function AccountSettingsScreen() {
  const { toast, show } = useToast();
  return (
    <View style={styles.root}>
      <Screen>
        <ProfilePhoto onNotify={show} />
        <CloudSection />
      </Screen>
      {toast}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
