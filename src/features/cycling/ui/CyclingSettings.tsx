import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Field } from '@/components/Input';
import { NavRow } from '@/components/NavRow';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { WheelSection } from '@/features/sensors/ui/WheelSection';
import { fmtInt } from '@/i18n';
import { spacing } from '@/theme';

import { zoneBounds } from '../power';
import { FTP_MAX_W, FTP_MIN_W, getFtp, parseFtp, rideProfile, setFtp } from '../settings';
import { zoneRangeKind } from './format';

/** Settings > Bersepeda: FTP with the power zones it gives, the body weight W/kg uses, and the wheel size. */
export function CyclingSettings() {
  const { t } = useTranslation('cycling');
  const { t: tb } = useTranslation('bikecomp');
  const router = useRouter();
  const [ftp, setFtpState] = useState<number | null>(getFtp);
  const [text, setText] = useState(() => (getFtp() === null ? '' : String(getFtp())));
  const [touched, setTouched] = useState(false);
  const [weightKg] = useState(() => rideProfile().weightKg);
  const range = { min: fmtInt(FTP_MIN_W), max: fmtInt(FTP_MAX_W) };

  const onChangeText = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, 3);
    setText(digits);
    const parsed = parseFtp(digits);
    if (parsed !== null) {
      setFtp(parsed);
      setFtpState(parsed);
    } else if (digits.length === 0) {
      setFtp(null);
      setFtpState(null);
    }
  };
  const clear = () => {
    setFtp(null);
    setFtpState(null);
    setText('');
  };
  const invalid = text.length > 0 && parseFtp(text) === null && (touched || text.length >= 3);

  return (
    <>
      <Section title={tb('settings.link.title')} icon="bicycle">
        <NavRow icon="speedometer" title={tb('settings.link.row')} subtitle={tb('settings.link.subtitle')} onPress={() => router.push('/settings/bikecomputer')} />
      </Section>

      <Section title={t('settings.ftp.title')} icon="flash">
        <Field
          label={t('settings.ftp.label')}
          hint={t('settings.ftp.hint', range)}
          value={text}
          onChangeText={onChangeText}
          onBlur={() => setTouched(true)}
          keyboardType="number-pad"
          maxLength={3}
          returnKeyType="done"
        />
        {invalid ? <Notice tone="danger">{t('settings.ftp.invalid', range)}</Notice> : null}
        {ftp === null ? <Notice icon="information-circle-outline">{t('settings.ftp.unset')}</Notice> : null}
        {text.length > 0 ? <Button label={t('settings.ftp.clear')} variant="secondary" icon="close-circle-outline" onPress={clear} /> : null}
        <AppText variant="caption" muted>
          {t('settings.ftp.tip')}
        </AppText>
        <Details>{t('settings.ftp.body')}</Details>
      </Section>

      <Section title={t('settings.zones.title')} icon="stats-chart">
        {ftp === null ? (
          <AppText variant="caption" muted>
            {t('settings.zones.empty')}
          </AppText>
        ) : (
          <>
            <AppText variant="caption" muted>
              {t('settings.zones.body', { ftp: fmtInt(ftp) })}
            </AppText>
            <View style={styles.zones}>
              {zoneBounds(ftp).map((zone, i) => {
                const kind = zoneRangeKind(zone);
                const value =
                  kind === 'from'
                    ? t('settings.zones.from', { from: fmtInt(zone.fromW) })
                    : kind === 'to'
                      ? t('settings.zones.to', { to: fmtInt(zone.toW ?? 0) })
                      : t('settings.zones.range', { from: fmtInt(zone.fromW), to: fmtInt(zone.toW ?? 0) });
                return <KeyValue key={zone.key} label={t('powerZones.zone', { n: i + 1, name: t(`powerZones.name.${zone.key}`) })} value={value} />;
              })}
            </View>
          </>
        )}
      </Section>

      <Section title={t('settings.weight.title')} icon="body">
        <AppText variant="caption" muted>
          {t('settings.weight.body', { kg: fmtInt(weightKg) })}
        </AppText>
        <Button label={t('settings.weight.action')} variant="secondary" icon="person-outline" onPress={() => router.push('/settings/profile')} />
      </Section>

      <WheelSection />
    </>
  );
}

const styles = StyleSheet.create({
  zones: { gap: spacing.xs },
});
