import type { TFunction } from 'i18next';

import type { CoachAccess } from '@/features/coach/useCoachAccess';
import type { ByokAccess } from '../access';
import { hostOf } from '../providers';
import type { AiSettings } from '../settings';

type AiT = TFunction<'ai'>;

/** The tokens one scheduled insight is expected to use (the settings lines and the "regenerate" question say so). */
export const INSIGHT_TOKENS = { daily: 500, weekly: 700 } as const;

/** The daily call limits the settings offer. */
export const CEILING_CHOICES = [20, 40, 100] as const;

/** A model id without the router prefix ("anthropic/claude-haiku-5.5" shows as "claude-haiku-5.5"). */
export const modelShort = (model: string): string => model.split('/').pop() || model;

/** The line under "Joyo AI" in Settings: which engine answers, or that nothing is set up. */
export function hubStatusLine(args: { settings: AiSettings; access: ByokAccess | null; coachAccess: CoachAccess }, t: AiT): string {
  const { settings, access, coachAccess } = args;
  const provider = settings.provider;
  if (settings.engine === 'byok') {
    if (access?.ok) return t('status.own', { provider: access.provider === 'custom' ? hostOf(access.baseUrl) : t(`provider.${access.provider}`), model: modelShort(access.model) });
    if (access && !access.ok && access.reason === 'minor') return t('status.minor');
    if (provider) return t('status.ownCheck', { provider: t(`provider.${provider}`) });
  }
  if (coachAccess === 'pro') return t('status.pro');
  return t('status.none');
}

/** "claude-haiku-5.5, kunci sendiri": the chip in the chat header when the own key answers. */
export const ownChipLabel = (access: Extract<ByokAccess, { ok: true }>, t: AiT): string => t('chip.own', { model: modelShort(access.model) });
