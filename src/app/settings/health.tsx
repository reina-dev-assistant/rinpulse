import { Screen } from '@/components/Screen';
import { HealthConnectSection } from '@/features/settings/HealthConnectSection';
import { HealthyLivingSection } from '@/features/settings/HealthyLivingSection';

export default function HealthSettingsScreen() {
  return (
    <Screen>
      <HealthConnectSection />
      <HealthyLivingSection />
    </Screen>
  );
}
