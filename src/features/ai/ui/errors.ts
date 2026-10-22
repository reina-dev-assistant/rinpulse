import type { TFunction } from 'i18next';

import { PROVIDERS } from '../providers';
import { AiError, type AiErrorKind, type ProviderId } from '../types';

type AiT = TFunction<'ai'>;

/** Where the next step of an error leads. */
export type ErrorTarget = 'setup' | 'model' | 'settings' | 'keyPage';

export interface AiErrorView {
  kind: AiErrorKind | 'unknown';
  /** The cause and what to do next, in one short text. */
  message: string;
  action: { label: string; target: ErrorTarget } | null;
  /** The provider's own words, for a collapsed "message from the provider" line. Never contains the key. */
  detail: string | null;
  /** The HTTP status the provider answered with, when it did. */
  status: number | null;
  /** Whose words `detail` is: the provider's, or the engine's own technical line (finish reason, lengths). */
  detailFrom: 'provider' | 'engine';
}

const BLOCK_REASONS = ['ceiling', 'noKey', 'noConsent', 'noProvider', 'minor', 'badUrl'] as const;
type BlockReason = (typeof BLOCK_REASONS)[number];
const isBlockReason = (v: string | null): v is BlockReason => v !== null && (BLOCK_REASONS as readonly string[]).includes(v);

const DETAIL_CHARS = 300;

/** The cause and next step of an error; `viewAiError` adds the technical fields. */
function describe(error: unknown, t: AiT, ctx: { provider: ProviderId | null; ceiling: number }): Omit<AiErrorView, 'status' | 'detailFrom'> {
  if (!(error instanceof AiError)) return { kind: 'unknown', message: t('errors.unknown'), action: null, detail: null };
  const detail = error.kind === 'blocked' || !error.detail ? null : error.detail.slice(0, DETAIL_CHARS);
  const go = (label: string, target: ErrorTarget) => ({ label, target });
  switch (error.kind) {
    case 'badKey':
    case 'forbidden':
      return { kind: error.kind, message: t(`errors.${error.kind}`), action: go(t('errors.action.setup'), 'setup'), detail };
    case 'quota': {
      const keyPage = ctx.provider ? PROVIDERS[ctx.provider].keyUrl : null;
      return { kind: 'quota', message: t('errors.quota'), action: keyPage ? go(t('errors.action.keyPage'), 'keyPage') : null, detail };
    }
    case 'modelNotFound':
    case 'noTools':
      return { kind: error.kind, message: t(`errors.${error.kind}`), action: go(t('errors.action.model'), 'model'), detail };
    case 'badRequest':
      if (error.detail === 'url') return { kind: 'badRequest', message: t('errors.badUrl'), action: go(t('errors.action.setup'), 'setup'), detail: null };
      return { kind: 'badRequest', message: t('errors.badRequest'), action: go(t('errors.action.model'), 'model'), detail };
    case 'blocked': {
      const reason = isBlockReason(error.detail) ? error.detail : null;
      if (reason === 'ceiling') return { kind: 'blocked', message: t('errors.blocked.ceiling', { ceiling: ctx.ceiling }), action: go(t('errors.action.settings'), 'settings'), detail: null };
      if (reason === 'minor') return { kind: 'blocked', message: t('errors.blocked.minor'), action: go(t('errors.action.settings'), 'settings'), detail: null };
      if (reason) return { kind: 'blocked', message: t(`errors.blocked.${reason}`), action: go(t('errors.action.setup'), 'setup'), detail: null };
      return { kind: 'blocked', message: t('errors.blocked.other'), action: go(t('errors.action.settings'), 'settings'), detail: null };
    }
    case 'rateLimit':
    case 'server':
    case 'network':
    case 'timeout':
    case 'empty':
    case 'aborted':
      return { kind: error.kind, message: t(`errors.${error.kind}`), action: null, detail };
    case 'truncated':
      return { kind: 'truncated', message: t('errors.truncated'), action: go(t('errors.action.model'), 'model'), detail };
  }
}

/**
 * Words an error for the person: what happened (the cause), and the one next step, plus what a bug report needs: the kind, the HTTP
 * status and the detail line, for the collapsed "technical details" under the notice. `provider` is the provider in use (for the link
 * to its key page); `ceiling` is the daily call limit set on this phone.
 */
export function viewAiError(error: unknown, t: AiT, ctx: { provider: ProviderId | null; ceiling: number }): AiErrorView {
  const view = describe(error, t, ctx);
  if (!(error instanceof AiError) || error.kind === 'blocked') return { ...view, status: null, detailFrom: 'provider' };
  // `empty` and `truncated` carry the engine's own line (finish reason, character counts); the others carry the provider's words.
  return { ...view, status: error.status, detailFrom: error.kind === 'empty' || error.kind === 'truncated' ? 'engine' : 'provider' };
}
