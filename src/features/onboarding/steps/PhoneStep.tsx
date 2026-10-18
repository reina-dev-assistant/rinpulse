import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SupportedWatches } from '@/features/device/SupportedWatches';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { WeightForm } from '@/features/onboarding/steps/WeightForm';
import { spacing } from '@/theme';

/**
 * The first step of the no-watch route: what works on the phone alone, the body weight the energy estimate runs on, and which watches
 * would add more (with the way to ask for one that is missing). Pairing stays open from the Watch tab.
 */
export function PhoneStep() {
  const { t } = useTranslation('onboarding');
  return (
    <>
      <StepIntro icon="barbell" tint="workouts" title={t('phone.title')}>
        {t('phone.intro')}
      </StepIntro>
      <Card>
        <View style={styles.list}>
          <Bullet label="1">{t('phone.logger')}</Bullet>
          <Bullet label="2">{t('phone.coach')}</Bullet>
          <Bullet label="3">{t('phone.library')}</Bullet>
          <Bullet label="4">{t('phone.rogo')}</Bullet>
        </View>
      </Card>
      <AppText variant="caption" muted>
        {t('phone.weightIntro')}
      </AppText>
      <WeightForm />
      <SupportedWatches />
      <Notice icon="watch-outline">{t('phone.later')}</Notice>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
