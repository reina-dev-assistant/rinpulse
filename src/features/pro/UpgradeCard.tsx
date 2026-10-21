import * as Linking from 'expo-linking';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { priceLine } from '@/features/onboarding/pro';
import { openProUpgrade, proUpgradeAction, type ProMoment } from '@/features/pro/offer';
import { useDismissal } from '@/features/pro/useDismissal';
import { useProConfig } from '@/features/pro/useProConfig';
import { spacing } from '@/theme';
import { HuaweiWear } from '@/wear';

interface UpgradeCardProps {
  /** Where the card sits: picks the copy and the campaign of the link. */
  moment: ProMoment;
  /** Adds "Nanti", which hides the card for two weeks. Only for a card that is inline and blocks nothing. */
  dismissible?: boolean;
}

/**
 * The one JoyoRogo Pro offer inside JoyoFit, placed where Pro would have helped (see `ProMoment`). The button opens the JoyoRogo app
 * when it is installed, else its store page (Play, App Store) or, in a sideloaded build, the web page with the live price. What a
 * store build may show is decided in `proUpgradeAction`: no price and no web checkout on Play or iOS.
 */
export function UpgradeCard({ moment, dismissible = false }: UpgradeCardProps) {
  const { t } = useTranslation('pro');
  const action = useMemo(() => proUpgradeAction(isIos ? 'ios' : 'android', HuaweiWear.distribution, moment), [moment]);
  const config = useProConfig(action.showPrice);
  const { hidden, dismiss } = useDismissal(moment);
  const [failed, setFailed] = useState(false);
  if (dismissible && hidden) return null;

  const price = action.showPrice ? priceLine(config) : null;
  return (
    <Card>
      <View style={styles.head}>
        <IconChip icon="arrow-up-circle" tint="link" />
        <AppText variant="heading" style={styles.title}>
          {t('upgrade.title')}
        </AppText>
      </View>
      <AppText variant="caption" muted>
        {t(`upgrade.moment.${moment}`)}
      </AppText>
      {price ? <AppText variant="bodyStrong">{price}</AppText> : null}
      {action.kind === 'app-or-store' ? (
        <AppText variant="caption" muted>
          {t('upgrade.managed')}
        </AppText>
      ) : null}
      {failed ? (
        <AppText variant="caption" muted>
          {t('upgrade.openFailed')}
        </AppText>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={t('upgrade.cta')}
          variant="primary"
          icon="open-outline"
          onPress={() => void openProUpgrade(action, Linking.openURL).then((opened) => setFailed(!opened))}
          style={styles.grow}
        />
        {dismissible ? <Button label={t('upgrade.later')} variant="ghost" onPress={dismiss} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
});
