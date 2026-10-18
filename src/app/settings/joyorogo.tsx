import { Screen } from '@/components/Screen';
import { JoyoRogoDiarySection } from '@/features/settings/JoyoRogoDiarySection';

/** Settings, Koneksi, JoyoRogo: the push of workout energy to JoyoRogo's diary, with its status. */
export default function JoyoRogoSettingsScreen() {
  return (
    <Screen>
      <JoyoRogoDiarySection />
    </Screen>
  );
}
