import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Details } from '@/components/Details';
import { Field, Input } from '@/components/Input';
import { IconChip } from '@/components/IconChip';
import { Card, Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useToast } from '@/components/Toast';
import { spacing, useTheme } from '@/theme';
import { modelFor } from '../access';
import { connectProvider, testProvider, type TestResult } from '../engine';
import { useAiSettings, useByokAccess } from '../hooks';
import { cleanPastedKey, maskKey } from '../keyVault';
import { hostOf, isInsecureRemote, normalizeBaseUrl, PROVIDER_ORDER, PROVIDERS } from '../providers';
import { aiVault } from '../stores';
import type { ModelInfo, ProviderId } from '../types';
import { ConsentCard } from './ConsentCard';
import { viewAiError, type AiErrorView } from './errors';
import { AiErrorNotice } from './AiErrorNotice';
import { ModelPicker } from './ModelPicker';

/** How long the saved confirmation shows before the screen closes. */
const SAVED_MS = 900;

type TestOk = Extract<TestResult, { ok: true }>;

/** "Atur kunci sendiri": provider, key, model, the test, and the consent, then save. Under 18 there is nothing to set up. */
export function SetupScreen() {
  const { t } = useTranslation('ai');
  const router = useRouter();
  const { access } = useByokAccess();
  if (access === null) {
    return (
      <Screen>
        <Skeleton width="100%" height={220} radius="card" />
      </Screen>
    );
  }
  if (!access.ok && access.reason === 'minor') {
    return (
      <Screen>
        <Card>
          <View style={styles.head}>
            <IconChip icon="person" tint="link" />
            <AppText variant="heading" style={styles.grow}>
              {t('gate.minor.title')}
            </AppText>
          </View>
          <AppText variant="caption" muted>
            {t('gate.minor.body')}
          </AppText>
          <Button label={t('setup.back')} variant="primary" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }
  return <SetupForm />;
}

function SetupForm() {
  const { t } = useTranslation('ai');
  const router = useRouter();
  const { colors, radius } = useTheme();
  const settings = useAiSettings();
  const { toast, show } = useToast();

  const [provider, setProvider] = useState<ProviderId>(settings.provider ?? 'openrouter');
  const [baseUrl, setBaseUrl] = useState(settings.customBaseUrl);
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [pasteEmpty, setPasteEmpty] = useState(false);
  const [stored, setStored] = useState<{ provider: ProviderId; mask: string | null } | null>(null);
  const [model, setModel] = useState(() => modelFor(settings, settings.provider ?? 'openrouter'));
  const [models, setModels] = useState<readonly ModelInfo[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<{ snap: string; ok: TestOk } | null>(null);
  const [testError, setTestError] = useState<AiErrorView | null>(null);
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const preset = PROVIDERS[provider];
  const name = t(`provider.${provider}`);
  const keySavedFlag = settings.keySaved[provider] === true;

  const mounted = useRef(true);
  const testCtl = useRef<AbortController | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      testCtl.current?.abort();
      clearTimeout(closeTimer.current);
    };
  }, []);

  // The saved key is shown masked, never in full: read it only to mask it.
  useEffect(() => {
    if (!keySavedFlag) return;
    let cancelled = false;
    aiVault
      .get(provider)
      .then((saved) => {
        if (!cancelled) setStored({ provider, mask: saved ? maskKey(saved) : null });
      })
      .catch(() => {
        if (!cancelled) setStored({ provider, mask: null });
      });
    return () => {
      cancelled = true;
    };
  }, [provider, keySavedFlag]);

  const savedMask = keySavedFlag && stored?.provider === provider ? stored.mask : null;
  const usingSaved = savedMask !== null && !replacing;
  const typedKey = cleanPastedKey(key);
  const keyReady = usingSaved || typedKey.length > 0;

  const endpoint = preset.customUrl ? normalizeBaseUrl(baseUrl) : preset.baseUrl;
  const urlError = !preset.customUrl || baseUrl.trim() === '' ? null : endpoint === null ? t('setup.url.invalid') : isInsecureRemote(endpoint) ? t('setup.url.insecure') : null;
  const urlReady = endpoint !== null && !isInsecureRemote(endpoint);
  const modelReady = model.trim().length > 0;

  const snapOf = (m: string) => `${provider}|${endpoint ?? ''}|${usingSaved ? 'saved' : typedKey}|${m.trim()}`;
  const snap = snapOf(model);
  const testedNow = tested !== null && tested.snap === snap ? tested.ok : null;

  const choose = (next: ProviderId) => {
    if (next === provider) return;
    testCtl.current?.abort();
    setProvider(next);
    setKey('');
    setReplacing(false);
    setPasteEmpty(false);
    setBaseUrl(PROVIDERS[next].customUrl ? settings.customBaseUrl : '');
    setModel(modelFor(settings, next));
    setModels(null);
    setTested(null);
    setTestError(null);
    setSaveFailed(false);
    setAgree(false);
  };

  const paste = async () => {
    const raw = await Clipboard.getStringAsync().catch(() => '');
    const clean = cleanPastedKey(raw);
    setPasteEmpty(clean.length === 0);
    if (clean.length > 0) setKey(clean);
  };

  const openKeyPage = () => {
    if (preset.keyUrl) void Linking.openURL(preset.keyUrl).catch(() => {});
  };

  const currentKey = async (): Promise<string | null> => (usingSaved ? aiVault.get(provider) : typedKey || null);

  /** The connection test with the key on screen or the saved one: lists the models, sends one tiny message. Returns the result when it passed. */
  const runTest = async (): Promise<TestOk | null> => {
    const apiKey = await currentKey();
    if (!apiKey || endpoint === null) return null;
    testCtl.current?.abort();
    const ctl = new AbortController();
    testCtl.current = ctl;
    setTesting(true);
    setTestError(null);
    setSaveFailed(false);
    try {
      const result = await testProvider({ provider, baseUrl: endpoint, apiKey, model: model.trim() || null, signal: ctl.signal });
      if (ctl.signal.aborted || !mounted.current) return null;
      if (result.ok) {
        if (result.models.length > 0) setModels(result.models);
        setModel(result.model);
        setTested({ snap: snapOf(result.model), ok: result });
        return result;
      }
      setTested(null);
      setTestError(viewAiError(result.error, t, { provider, ceiling: settings.dailyCeiling }));
      return null;
    } catch {
      if (!ctl.signal.aborted && mounted.current) {
        setTested(null);
        setTestError(viewAiError(null, t, { provider, ceiling: settings.dailyCeiling }));
      }
      return null;
    } finally {
      if (testCtl.current === ctl) testCtl.current = null;
      if (mounted.current) setTesting(false);
    }
  };

  const busy = testing || saving;
  const canSubmit = keyReady && urlReady && modelReady && adult && agree && !busy && !saved;

  const submit = async () => {
    if (!canSubmit || endpoint === null) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const result = testedNow ?? (await runTest());
      if (!result || !mounted.current) return;
      const apiKey = await currentKey();
      if (!apiKey) return;
      await connectProvider({ provider, baseUrl: endpoint, apiKey, model: result.model });
      if (!mounted.current) return;
      setKey('');
      setSaved(true);
      show(t('setup.saved'));
      closeTimer.current = setTimeout(() => router.back(), SAVED_MS);
    } catch {
      if (mounted.current) setSaveFailed(true);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <Screen
        footer={
          <View style={styles.footer}>
            {saveFailed ? <Notice tone="danger">{t('setup.saveFailed')}</Notice> : null}
            {!canSubmit && !busy && !saved ? (
              <AppText variant="caption" muted>
                {t('setup.needs')}
              </AppText>
            ) : null}
            <Button
              label={testedNow ? t('setup.save') : t('setup.testSave')}
              variant="primary"
              icon="checkmark"
              disabled={!canSubmit}
              loading={busy}
              done={saved}
              onPress={() => void submit()}
            />
          </View>
        }>
        <AppText variant="caption" muted>
          {t('setup.intro')}
        </AppText>

        <Section title={t('setup.step1')} icon="business" tint="link">
          <View style={styles.chips}>
            {PROVIDER_ORDER.map((id) => (
              <Chip key={id} label={t(`provider.${id}`)} selected={id === provider} role="radio" onPress={() => choose(id)} />
            ))}
          </View>
          <AppText variant="caption" muted>
            {t(`setup.hint.${provider}`)}
          </AppText>
          {preset.customUrl ? (
            <Field
              label={t('setup.url.label')}
              hint={urlError ?? t('setup.url.hint')}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={t('setup.url.placeholder')}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          {urlError ? <Notice tone="danger">{urlError}</Notice> : null}
        </Section>

        <Section title={t('setup.step2')} icon="key" tint="link">
          {usingSaved ? (
            <View style={styles.saved}>
              <AppText variant="bodyStrong" style={styles.grow}>
                {t('setup.key.saved', { masked: savedMask })}
              </AppText>
              <Button label={t('setup.key.replace')} onPress={() => setReplacing(true)} />
            </View>
          ) : (
            <View style={styles.keyRow}>
              <View style={styles.grow}>
                <Input
                  value={key}
                  onChangeText={(v) => {
                    setKey(v);
                    setPasteEmpty(false);
                  }}
                  placeholder={preset.keyPlaceholder}
                  accessibilityLabel={t('setup.key.label')}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  importantForAutofill="no"
                  spellCheck={false}
                />
              </View>
              <Button label={t('setup.key.paste')} icon="clipboard" onPress={() => void paste()} />
            </View>
          )}
          {pasteEmpty ? (
            <AppText variant="caption" danger>
              {t('setup.key.pasteEmpty')}
            </AppText>
          ) : null}
          {replacing && savedMask !== null ? <Button label={t('setup.key.keepSaved')} variant="ghost" onPress={() => { setReplacing(false); setKey(''); }} /> : null}
          {preset.keyUrl ? <Button label={t('setup.key.open', { provider: name })} variant="ghost" icon="open-outline" onPress={openKeyPage} /> : null}
          <AppText variant="caption" muted>
            {t('setup.key.tip')}
          </AppText>
          <Details title={t('setup.key.revokeTitle')}>{t('setup.key.revoke')}</Details>

          <ModelPicker provider={provider} value={model} onChange={setModel} models={models} />

          <Button label={t('setup.test.run')} icon="pulse" loading={testing} disabled={!keyReady || !urlReady || !modelReady || saving} onPress={() => void runTest()} />
          {testedNow ? (
            <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
              {t('setup.test.ok', { count: testedNow.calls })}
            </AppText>
          ) : null}
          {testError ? <AiErrorNotice view={testError} provider={provider} /> : null}
          <AppText variant="caption" muted>
            {t('setup.test.hint')}
          </AppText>
        </Section>

        <Section title={t('setup.step3')} icon="shield-checkmark" tint="link">
          {preset.freeTierTrainsOnData ? (
            <View style={[styles.warn, { borderColor: colors.destructive, borderRadius: radius.input + 2 }]}>
              <Notice tone="danger" icon="warning">
                {t('consent.gemini')}
              </Notice>
            </View>
          ) : null}
          <ConsentCard provider={name} host={endpoint ? hostOf(endpoint) : t('consent.noHost')} onSample={() => router.push('/settings/ai-data')} />
          <SwitchRow label={t('consent.adult')} value={adult} onValueChange={setAdult} />
          <SwitchRow label={t('consent.agree', { provider: name })} value={agree} onValueChange={setAgree} />
          <AppText variant="caption" muted>
            {t('consent.withdraw')}
          </AppText>
        </Section>
      </Screen>
      {toast}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  saved: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  warn: { borderWidth: 1.5 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.sm },
});
