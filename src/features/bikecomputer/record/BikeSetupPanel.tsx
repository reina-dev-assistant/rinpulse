import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';

import { bikeSettingsStore } from '../settings';
import { useBikeSettings } from '../ui/useBikeSettings';
import { RoutePickerSheet } from './RoutePickerSheet';
import { useChosenRoute } from './useChosenRoute';

/**
 * The record picker's block for Ride: the switch for bike computer mode and, with it on, the route the ride follows. The same switch is
 * in Settings > Bersepeda > Komputer sepeda.
 */
export function BikeSetupPanel() {
  const { t } = useTranslation('bikecomp');
  const settings = useBikeSettings();
  const { card, cards, choose } = useChosenRoute();
  const [sheet, setSheet] = useState(false);

  return (
    <Section title={t('picker.toggle.title')} icon="speedometer" tint="workouts">
      <SwitchRow
        label={t('picker.toggle.title')}
        hint={t('picker.toggle.hint')}
        value={settings.enabled}
        onValueChange={(enabled) => bikeSettingsStore.set({ enabled })}
      />
      {settings.enabled ? (
        <Button
          label={card ? t('route.chosen', { name: card.route.name }) : t('route.pick')}
          icon="trail-sign-outline"
          onPress={() => setSheet(true)}
        />
      ) : null}
      <RoutePickerSheet
        visible={sheet}
        cards={cards}
        selectedId={card?.route.id ?? null}
        onPick={(id) => {
          choose(id);
          setSheet(false);
        }}
        onClose={() => setSheet(false)}
      />
    </Section>
  );
}
