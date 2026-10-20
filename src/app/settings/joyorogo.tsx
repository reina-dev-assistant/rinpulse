import { Screen } from '@/components/Screen';
import { SleepInsightsSection } from '@/features/settings/SleepInsightsSection';
import { JoyoRogoDiarySection } from '@/features/settings/JoyoRogoDiarySection';

/** Settings, Koneksi, JoyoRogo: the push of workout energy to JoyoRogo's diary, with its status, and the Sleep insights switch. */
export default function JoyoRogoSettingsScreen() {
  return (
    <Screen>
      <JoyoRogoDiarySection />
      <SleepInsightsSection />
    </Screen>
  );
}
