import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NavRow } from '@/components/NavRow';
import { Card } from '@/components/Screen';

/** One quiet row on Today and Workouts that opens the Loop planner (`/routes/loop`), so it is not only behind Watch > Routes. */
export function LoopShortcut() {
  const router = useRouter();
  const { t } = useTranslation('loops');
  return (
    <Card>
      <NavRow icon="repeat" tint="steps" title={t('shortcut.title')} subtitle={t('shortcut.subtitle')} onPress={() => router.push('/routes/loop')} />
    </Card>
  );
}
