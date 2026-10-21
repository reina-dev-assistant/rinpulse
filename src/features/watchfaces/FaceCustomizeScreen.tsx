import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Input';
import { Card, Screen, Section } from '@/components/Screen';
import { EmptyState, LoadingState, Notice } from '@/components/States';
import {
  FACE_MODE_ROWS,
  MAX_OPTION_INDEX,
  isEditable,
  styleIndex,
  visibleOptions,
  withStyle,
  withWidget,
} from '@/features/watchfaces/faceCustomModel';
import { useFaceCustomization } from '@/features/watchfaces/useFaceCustomization';
import { spacing } from '@/theme';

/** Options are numbered 1, 2, 3 ... from the watch's 0-based indexes; the watch sends no names and no counts. */
function OptionPicker({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: number | null;
  disabled: boolean;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation('watch');
  const [extra, setExtra] = useState(0);
  const count = visibleOptions(selected, extra);
  return (
    <View style={styles.picker}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {Array.from({ length: count }, (_, index) => (
          <Chip
            key={index}
            role="radio"
            label={String(index + 1)}
            selected={index === selected}
            onPress={() => !disabled && onSelect(index)}
          />
        ))}
        {count <= MAX_OPTION_INDEX ? <Chip label={t('faceEdit.more')} selected={false} onPress={() => setExtra((e) => e + 4)} /> : null}
      </View>
    </View>
  );
}

/** Edits the options of a face that is already on the watch: style, background, typeface, hands, colour and widget slots. */
export function FaceCustomizeScreen() {
  const router = useRouter();
  const { t } = useTranslation('watch');
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { connected, draft, setDraft, busy, error, notice, dirty, revertable, load, apply, revert } = useFaceCustomization(id);
  const idle = busy === null;

  if (!connected) {
    return (
      <Screen>
        <Notice icon="bluetooth" action={{ label: t('openWatch'), onPress: () => router.navigate('/watch') }}>
          {t('faceEdit.connect')}
        </Notice>
      </Screen>
    );
  }

  if (draft === null) {
    return (
      <Screen>
        {busy === 'load' ? (
          <LoadingState label={t('faceEdit.loading')} />
        ) : (
          <>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Card>
              <EmptyState
                icon="color-palette"
                title={t('faceEdit.noneRead')}
                description={t('faceEdit.noneReadHint')}
                action={{ label: t('faceEdit.tryAgain'), icon: 'refresh', onPress: () => void load() }}
              />
            </Card>
          </>
        )}
      </Screen>
    );
  }

  const modes = FACE_MODE_ROWS.filter((row) => styleIndex(draft, row.mode) !== null);
  const hasColour = draft.colourIndex !== null;

  return (
    <Screen>
      <View style={styles.title}>
        <AppText variant="title" accessibilityRole="header">
          {name ?? t('faceEdit.faceId', { id })}
        </AppText>
        <AppText variant="caption" muted>
          {t('faceEdit.faceId', { id })}
        </AppText>
      </View>
      {notice ? <Notice icon="checkmark-circle">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {!isEditable(draft) ? (
        <Card>
          <EmptyState
            icon="color-palette"
            title={t('faceEdit.nothing')}
            description={t('faceEdit.nothingHint')}
          />
        </Card>
      ) : null}

      {modes.length > 0 ? (
        <Section title={t('faceEdit.look')} icon="color-palette">
          {modes.map((row) => (
            <OptionPicker
              key={row.mode}
              label={t(`faceEdit.modes.${row.key}`)}
              selected={styleIndex(draft, row.mode)}
              disabled={!idle}
              onSelect={(index) => setDraft(withStyle(draft, row.mode, index))}
            />
          ))}
        </Section>
      ) : null}

      {hasColour ? (
        <Section title={t('faceEdit.colour')} icon="color-fill">
          <OptionPicker
            label={t('faceEdit.palette')}
            selected={draft.colourIndex}
            disabled={!idle}
            onSelect={(index) => setDraft({ ...draft, colourIndex: index })}
          />
          <Field
            label={t('faceEdit.customColour')}
            hint={t('faceEdit.customColourHint')}
            value={draft.customColour ?? ''}
            editable={idle}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="#RRGGBB" // i18n-ok: colour format
            onChangeText={(text) => setDraft({ ...draft, customColour: text.trim() === '' ? null : text.trim() })}
          />
        </Section>
      ) : null}

      {draft.widgets.length > 0 ? (
        <Section title={t('faceEdit.widgets')} icon="apps">
          {draft.widgets.map((option, slot) => (
            <OptionPicker
              key={slot}
              label={t('faceEdit.slot', { n: slot + 1 })}
              selected={option}
              disabled={!idle}
              onSelect={(index) => setDraft(withWidget(draft, slot, index))}
            />
          ))}
        </Section>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={t('faceEdit.apply')}
          variant="primary"
          icon="checkmark-circle"
          disabled={!dirty || !idle}
          loading={busy === 'apply'}
          onPress={() => void apply()}
        />
        <Button
          label={t('faceEdit.revert')}
          icon="arrow-undo"
          disabled={!revertable || !idle}
          loading={busy === 'revert'}
          onPress={() => void revert()}
        />
      </View>

      <Details>{t('faceEdit.explain')}</Details>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { gap: 2 },
  picker: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
