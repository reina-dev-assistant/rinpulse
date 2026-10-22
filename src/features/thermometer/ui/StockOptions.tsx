import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Field } from '@/components/Input';
import { Notice } from '@/components/States';
import { parseBindkey } from '@/features/sensors/miBeacon';
import { spacing } from '@/theme';

import type { FoundThermometer } from '../discovery';
import type { GattFailure, GattResult } from '../gattRead';
import type { BindkeyPairResult } from '../useThermometer';

/** Where the bind key comes from: Piotr Machowski's cloud token extractor (reads the key from the Xiaomi account) and ATC1441's Telink flasher. */
const TOKEN_EXTRACTOR_URL = 'https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor';
const TELINK_FLASHER_URL = 'https://atc1441.github.io/TelinkFlasher.html';

interface StockOptionsProps {
  device: FoundThermometer;
  /** Pairs the unit read over a connection; stops the search first. */
  onPairGatt: (device: FoundThermometer) => Promise<GattResult>;
  /** Checks the key against the unit's broadcasts and pairs it. */
  onPairBindkey: (device: FoundThermometer, text: string) => Promise<BindkeyPairResult>;
}

type Step = 'choose' | 'key';

/**
 * What a listed unit on the stock Xiaomi firmware offers: read it over a short connection (no key), or open its encrypted broadcasts with the
 * bind key the person types in. The key is checked against what the unit broadcast before it is kept, and never leaves the secure store.
 */
export function StockOptions({ device, onPairGatt, onPairBindkey }: StockOptionsProps) {
  const { t } = useTranslation('thermometer');
  const [step, setStep] = useState<Step>('choose');
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gattProblem, setGattProblem] = useState<GattFailure | null>(null);
  const [keyProblem, setKeyProblem] = useState<Exclude<BindkeyPairResult, 'saved'> | null>(null);

  const digits = parseBindkey(text)?.length ?? text.replace(/[\s:-]/g, '').length;

  const connect = async () => {
    setBusy(true);
    setGattProblem(null);
    try {
      const result = await onPairGatt(device);
      if (!result.ok) setGattProblem(result.reason);
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    setBusy(true);
    setKeyProblem(null);
    try {
      const result = await onPairBindkey(device, text);
      if (result === 'saved') {
        setText('');
        setShown(false);
      } else {
        setKeyProblem(result);
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === 'key') {
    return (
      <View style={styles.box}>
        <Field
          label={t('stock.key.label')}
          hint={t('stock.key.length', { length: Math.min(digits, 99) })}
          value={text}
          onChangeText={(value) => {
            setText(value);
            setKeyProblem(null);
          }}
          secureTextEntry={!shown}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="no"
          maxLength={64}
        />
        {keyProblem ? <Notice tone="danger">{t(`stock.key.${keyProblem}`)}</Notice> : null}
        <View style={styles.actions}>
          <Button label={shown ? t('stock.key.hide') : t('stock.key.show')} icon={shown ? 'eye-off-outline' : 'eye-outline'} onPress={() => setShown((v) => !v)} />
          <Button
            label={t('stock.key.save')}
            icon="checkmark"
            variant="primary"
            loading={busy}
            disabled={text.trim().length === 0}
            onPress={() => void saveKey()}
          />
          <Button
            label={t('stock.key.back')}
            variant="ghost"
            onPress={() => {
              setStep('choose');
              setKeyProblem(null);
            }}
          />
        </View>
        <Details title={t('stock.help.title')}>
          <View style={styles.help}>
            <AppText variant="caption" muted>
              {t('stock.help.where')}
            </AppText>
            <AppText variant="caption" muted>
              {t('stock.help.extractor')}
            </AppText>
            <Button label={t('stock.help.openExtractor')} icon="open-outline" variant="ghost" onPress={() => void Linking.openURL(TOKEN_EXTRACTOR_URL)} />
            <AppText variant="caption" muted>
              {t('stock.help.flasher')}
            </AppText>
            <Button label={t('stock.help.openFlasher')} icon="open-outline" variant="ghost" onPress={() => void Linking.openURL(TELINK_FLASHER_URL)} />
            <Notice tone="danger" icon="warning">
              {t('stock.help.warning')}
            </Notice>
            <AppText variant="caption" muted>
              {t('stock.help.privacy')}
            </AppText>
          </View>
        </Details>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <AppText variant="caption" muted>
        {t('stock.choose')}
      </AppText>
      {gattProblem ? <Notice tone="danger">{t(`stock.gatt.${gattProblem}`)}</Notice> : null}
      <View style={styles.actions}>
        <Button label={busy ? t('stock.connecting') : t('stock.direct')} icon="bluetooth" variant="primary" loading={busy} onPress={() => void connect()} />
        <Button label={t('stock.bindkey')} icon="key-outline" disabled={busy} onPress={() => setStep('key')} />
      </View>
      <Details title={t('stock.compare.title')}>
        <View style={styles.help}>
          <AppText variant="caption" muted>
            {t('stock.compare.direct')}
          </AppText>
          <AppText variant="caption" muted>
            {t('stock.compare.bindkey')}
          </AppText>
        </View>
      </Details>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm, paddingBottom: spacing.sm },
  actions: { gap: spacing.sm },
  help: { gap: spacing.sm },
});
