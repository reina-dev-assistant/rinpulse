import { useCoachAccess } from '@/features/coach/useCoachAccess';

/** JoyoRogo Pro: the one plan JoyoFit knows. Pro people may turn the JoyoFit watermark off. */
export function useStickerPro(): boolean {
  return useCoachAccess() === 'pro';
}
