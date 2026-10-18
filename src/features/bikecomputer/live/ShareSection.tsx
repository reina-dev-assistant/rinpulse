import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SwitchRow } from '@/components/SwitchRow';
import { Notice } from '@/components/States';
import { fmtClock } from '@/i18n';
import { spacing } from '@/theme';

import { hasLiveConsent, liveTracker, setLiveConsent } from './liveConfig';
import type { LiveState } from './tracker';
import { useLiveTracker } from './useLiveTracker';

interface ShareSectionProps {
  /** The persisted "Bagikan lokasi" choice (`BikeSettings.liveShare`). */
  enabled: boolean;
  /**
   * Called with the new choice once it is allowed (after the first-use dialog's "Lanjut"). The caller starts the tracker when a ride is
   * running and the choice turns on; turning it off ends the tracker here, so the link stops answering at once.
   */
  onEnabledChange: (enabled: boolean) => void;
}

/** The status line for a state; null when there is nothing to say. */
function useStatusLine(state: LiveState, enabled: boolean): string | null {
  const { t } = useTranslation('bikelive');
  switch (state.status) {
    case 'idle':
      return enabled ? t('status.idle') : null;
    case 'ended':
      return t('status.ended');
    case 'error':
      return state.error ? t(`status.error.${state.error}`) : null;
    case 'offline':
      return state.viewUrl ? t('status.offline', { count: state.pending }) : t('status.starting');
    case 'live':
      return state.lastPostAt === null ? t('status.waiting') : t('status.live', { time: fmtClock(state.lastPostAt) });
  }
}

/**
 * "Bagikan lokasi": the switch with its explanation, the first-use dialog, and, once the session exists, the link with Copy and Share and
 * a status line. Sits in the Ready screen and in settings; it owns no card, so the host decides the frame.
 */
export function ShareSection({ enabled, onEnabledChange }: ShareSectionProps) {
  const { t } = useTranslation('bikelive');
  const state = useLiveTracker();
  const status = useStatusLine(state, enabled);
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  const toggle = (next: boolean) => {
    if (!next) {
      void liveTracker.end();
      onEnabledChange(false);
    } else if (hasLiveConsent()) {
      onEnabledChange(true);
    } else {
      setAsking(true);
    }
  };

  const accept = () => {
    setLiveConsent();
    setAsking(false);
    onEnabledChange(true);
  };

  const url = state.status === 'live' || state.status === 'offline' ? state.viewUrl : null;
  const failed = state.status === 'error';

  return (
    <View style={styles.block}>
      <SwitchRow label={t('switch.label')} hint={t('switch.hint')} icon="location" value={enabled} onValueChange={toggle} />
      {url ? (
        <View style={styles.link}>
          <AppText variant="label" muted>
            {t('link.title')}
          </AppText>
          <AppText variant="caption" selectable>
            {url}
          </AppText>
          <ButtonRow>
            <Button
              label={copied ? t('link.copied') : t('link.copy')}
              icon={copied ? 'checkmark' : 'copy-outline'}
              onPress={() => {
                void Clipboard.setStringAsync(url).then(() => setCopied(true));
              }}
            />
            <Button
              label={t('link.share')}
              icon="share-outline"
              variant="primary"
              onPress={() => {
                void Share.share({ message: t('link.shareMessage', { url }) }).catch(() => {});
              }}
            />
          </ButtonRow>
        </View>
      ) : null}
      {status && failed ? <Notice tone="danger">{status}</Notice> : null}
      {status && !failed ? (
        <AppText variant="caption" muted accessibilityLiveRegion="polite">
          {status}
        </AppText>
      ) : null}
      <ConfirmDialog
        visible={asking}
        title={t('consent.title')}
        message={t('consent.message')}
        confirmLabel={t('consent.confirm')}
        onConfirm={accept}
        onCancel={() => setAsking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  link: { gap: spacing.sm },
});
