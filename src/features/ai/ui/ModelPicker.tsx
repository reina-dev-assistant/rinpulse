import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { LoadingState } from '@/components/States';
import { HIT, spacing, useColors } from '@/theme';
import { searchModels } from '../models';
import { PROVIDERS } from '../providers';
import type { ModelInfo, ProviderId } from '../types';

interface ModelPickerProps {
  provider: ProviderId;
  value: string;
  onChange: (model: string) => void;
  /** The provider's own list, once it has been loaded with the key; null before. */
  models: readonly ModelInfo[] | null;
  loading?: boolean;
  /** Why the list could not be loaded, already worded. */
  error?: string | null;
}

/**
 * Choosing the model. With the provider's list: a search field over it and the tool-capable models first, each marked when the
 * provider says it cannot call tools. Without it (before the connection test, or a gateway that has no list): the id typed
 * directly, and the preset's suggestions as one-tap choices.
 */
export function ModelPicker({ provider, value, onChange, models, loading, error }: ModelPickerProps) {
  const { t } = useTranslation('ai');
  const colors = useColors();
  const [query, setQuery] = useState('');
  const suggested = PROVIDERS[provider].suggested;
  const listed = models && models.length > 0 ? models : null;
  const chosen = listed?.find((m) => m.id === value);
  const results = listed ? searchModels(listed, query) : [];

  return (
    <View style={styles.wrap}>
      <AppText variant="label" muted>
        {t('model.title')}
      </AppText>
      {listed ? (
        <>
          <AppText variant="bodyStrong">{t('model.selected', { model: value })}</AppText>
          {chosen?.tools === false ? (
            <AppText variant="caption" danger>
              {t('model.noToolsChosen')}
            </AppText>
          ) : null}
          <Input icon="search" value={query} onChangeText={setQuery} placeholder={t('model.search')} accessibilityLabel={t('model.search')} autoCapitalize="none" autoCorrect={false} />
          {results.map((model) => {
            const selected = model.id === value;
            return (
              <PressableScale
                key={model.id}
                accessibilityRole="radio"
                accessibilityLabel={model.tools === false ? `${model.id}. ${t('model.noTools')}` : model.id}
                accessibilityState={{ selected }}
                onPress={() => onChange(model.id)}
                scaleTo={0.985}
                style={styles.row}>
                <View style={styles.rowText}>
                  <AppText variant="body" numberOfLines={1}>
                    {model.id}
                  </AppText>
                  {model.tools === false ? (
                    <AppText variant="caption" muted>
                      {t('model.noTools')}
                    </AppText>
                  ) : null}
                </View>
                {selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </PressableScale>
            );
          })}
          {results.length === 0 ? (
            <AppText variant="caption" muted>
              {t('model.none')}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            {t('model.noToolsHint')}
          </AppText>
        </>
      ) : (
        <>
          <Input value={value} onChangeText={onChange} placeholder={t('model.direct')} accessibilityLabel={t('model.title')} autoCapitalize="none" autoCorrect={false} />
          {suggested.length > 0 ? (
            <View style={styles.chips}>
              {suggested.map((model) => (
                <Chip key={model} label={model} selected={model === value} role="radio" onPress={() => onChange(model)} />
              ))}
            </View>
          ) : null}
          {loading ? <LoadingState label={t('model.loading')} /> : null}
          {error ? (
            <AppText variant="caption" danger>
              {error}
            </AppText>
          ) : null}
          {!loading && !error && models === null ? (
            <AppText variant="caption" muted>
              {t('model.afterTest')}
            </AppText>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowText: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
