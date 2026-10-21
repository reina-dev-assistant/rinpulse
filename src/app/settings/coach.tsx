import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Field } from '@/components/Input';
import { Section, Screen } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { LlmError, testLlm } from '@/features/coach/chat/localClient';
import {
  llmApiKey,
  llmSettings,
  localCoachEnabled,
  LLM_DEFAULTS,
  saveLlmApiKey,
  saveLlmSettings,
  setLocalCoachEnabled,
  type LlmSettings,
} from '@/features/coach/localSettings';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';

const row = { gap: spacing.sm } as const;

/**
 * Settings > Coach: the account-free mode and the endpoint the chat talks to.
 *
 * The plan, the suggestion and the exercise library are computed on the phone, so they only need the switch.
 * The chat is the one part that needs a server, and here it is the wearer's own: any OpenAI-compatible URL,
 * with a key kept in secure storage and sent nowhere but that URL.
 */
export default function CoachSettingsScreen() {
  const { t } = useTranslation('settings');
  const [enabled, setEnabled] = useState(localCoachEnabled);
  const [fields, setFields] = useState<Omit<LlmSettings, 'apiKey'>>(llmSettings);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // The key lives in secure storage, which is async; the rest reads synchronously so the fields never flash empty.
  const loadKey = useCallback(() => {
    void llmApiKey().then((key) => setApiKey(key ?? ''));
  }, []);
  useEffect(loadKey, [loadKey]);
  useNativeRefresh(
    useCallback(() => {
      setEnabled(localCoachEnabled());
      setFields(llmSettings());
      loadKey();
    }, [loadKey]),
  );

  const toggle = (value: boolean) => {
    setEnabled(value);
    setLocalCoachEnabled(value);
    setSaved(false);
    setResult(null);
  };

  const save = async () => {
    saveLlmSettings(fields);
    await saveLlmApiKey(apiKey);
    setFields(llmSettings());
    setResult(null);
    setSaved(true);
  };

  const test = async () => {
    setTesting(true);
    setSaved(false);
    setResult(null);
    try {
      const reply = await testLlm({ ...fields, apiKey: apiKey.trim() });
      setResult({ ok: true, message: t('coach.llm.testOk', { reply }) });
    } catch (e) {
      setResult({ ok: false, message: e instanceof LlmError ? e.message : errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Screen>
      <Section title={t('coach.title')} icon="barbell">
        <SwitchRow
          icon="person-outline"
          label={t('coach.noAccount')}
          hint={t('coach.noAccountHint')}
          value={enabled}
          onValueChange={toggle}
        />
        <Details>{t('coach.noAccountDetails')}</Details>
      </Section>

      {enabled ? (
        <Section title={t('coach.llm.title')} icon="sparkles">
          <Details>{t('coach.llm.intro')}</Details>
          <View style={row}>
            <Field
              label={t('coach.llm.baseUrl')}
              value={fields.baseUrl}
              onChangeText={(baseUrl) => setFields((current) => ({ ...current, baseUrl }))}
              placeholder={LLM_DEFAULTS.baseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Field
              label={t('coach.llm.model')}
              value={fields.model}
              onChangeText={(model) => setFields((current) => ({ ...current, model }))}
              placeholder={LLM_DEFAULTS.model}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              label={t('coach.llm.apiKey')}
              hint={t('coach.llm.apiKeyHint')}
              value={apiKey}
              onChangeText={(key) => {
                setApiKey(key);
                setSaved(false);
              }}
              placeholder={t('coach.llm.apiKeyPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </View>
          <View style={row}>
            <Button label={t('coach.llm.test')} variant="secondary" icon="flash-outline" onPress={() => void test()} loading={testing} />
            <Button label={t('coach.llm.save')} variant="primary" icon="checkmark" onPress={() => void save()} />
          </View>
          {saved ? <Notice>{t('coach.llm.saved')}</Notice> : null}
          {result ? <Notice tone={result.ok ? 'info' : 'danger'}>{result.message}</Notice> : null}
          <Details>{t('coach.llm.privacy')}</Details>
        </Section>
      ) : null}
    </Screen>
  );
}
