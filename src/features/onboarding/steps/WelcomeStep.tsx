import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { isIos } from '@/components/IosUnavailable';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Card } from '@/components/Screen';
import { SupportedWatches } from '@/features/device/SupportedWatches';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { useOnboarding } from '@/state/OnboardingProvider';
import { spacing } from '@/theme';

export function WelcomeStep() {
  const { t } = useTranslation('onboarding');
  const guide = useOnboarding();
  return (
    <>
      <StepIntro icon="watch" tint="link" title={t('welcome.title')}>
        {t('welcome.intro')}
      </StepIntro>
      <Card>
        <AppText variant="heading">{t('welcome.noWatch.title')}</AppText>
        <AppText variant="caption" muted>
          {t('welcome.noWatch.body')}
        </AppText>
        <Button label={t('welcome.noWatch.button')} variant="secondary" icon="barbell" lines={2} onPress={guide.chooseNoWatch} />
        <Details title={t('welcome.noWatch.supported')}>
          <SupportedWatches />
        </Details>
      </Card>
      <Card>
        <AppText variant="heading">{t('welcome.beforeTitle')}</AppText>
        <View style={styles.list}>
          <Bullet label="1">{t('welcome.before1')}</Bullet>
          <Bullet label="2">{isIos ? t('welcome.before2Ios') : t('welcome.before2Android')}</Bullet>
          <Bullet label="3">
            {t('welcome.before3')}
          </Bullet>
        </View>
      </Card>
      <Card>
        <AppText variant="heading">{t('welcome.coversTitle')}</AppText>
        <View style={styles.list}>
          <Bullet label="1">{t('welcome.covers1')}</Bullet>
          <Bullet label="2">{t('welcome.covers2')}</Bullet>
          <Bullet label="3">
            {isIos ? t('welcome.covers3Ios') : t('welcome.covers3Android')}
          </Bullet>
          <Bullet label="4">{t('welcome.covers4')}</Bullet>
        </View>
      </Card>
      <AppText variant="caption" muted>
        {t('welcome.reopen')}
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
