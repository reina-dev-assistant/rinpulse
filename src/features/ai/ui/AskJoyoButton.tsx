import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { HeaderIconButton } from '@/components/HeaderIconButton';
import { useCoachAccess } from '@/features/coach/useCoachAccess';
import { useByokAccess } from '../hooks';
import { joyoAiDestination, OPEN_JOYO_AI, type ChatSeed } from '../open';

/** Opens Joyo AI (or its setup when there is nothing to answer yet), optionally with a workout or a night to talk about. */
function useOpenJoyoAi(seed?: ChatSeed): () => void {
  const router = useRouter();
  const { access, settings } = useByokAccess();
  const coachAccess = useCoachAccess();
  return () => router.navigate(joyoAiDestination({ settings, access, coachAccess }, seed), OPEN_JOYO_AI);
}

/** The round "Tanya Joyo AI" button of a page header (Today, Workouts). The sparkle is the owner's choice for AI entry points. */
export function AskJoyoHeaderButton() {
  const { t } = useTranslation('ai');
  const open = useOpenJoyoAi();
  return <HeaderIconButton icon="sparkles" label={t('ask.header')} onPress={open} />;
}

/** A secondary action inside a detail screen: "Tanya soal latihan ini" / "Tanya soal tidur ini". */
export function AskJoyoAction({ seed }: { seed: ChatSeed }) {
  const { t } = useTranslation('ai');
  const open = useOpenJoyoAi(seed);
  return <Button label={t(seed.seed === 'workout' ? 'ask.workout' : 'ask.sleep')} variant="secondary" icon="chatbubble-ellipses" onPress={open} />;
}
