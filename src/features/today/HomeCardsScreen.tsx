import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Card, Screen } from '@/components/Screen';
import { HOME_CARD_IDS, isDefaultHomeCards, type HomeCardId } from '@/features/today/homeCards';
import { useHomeCards } from '@/features/today/homeCardsStore';
import { useTranslation } from '@/i18n';
import { HIT, spacing, useColors } from '@/theme';

function MoveButton({ direction, label, disabled, onPress }: { direction: 'up' | 'down'; label: string; disabled: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.move, disabled && styles.moveDisabled]}>
      <Ionicons name={direction === 'up' ? 'chevron-up' : 'chevron-down'} size={20} color={colors.foreground} />
    </Pressable>
  );
}

/**
 * "Atur kartu Beranda": every card below the watch on Today with a switch and up and down buttons. Buttons rather than a drag
 * handle: they work with TalkBack, a hardware keyboard and a shaky thumb, and the order is read out on each row.
 */
export function HomeCardsScreen() {
  const { t } = useTranslation('today');
  const colors = useColors();
  const { prefs, setHidden, move, reset } = useHomeCards();
  const name = (id: HomeCardId) => t(`cards.names.${id}`);

  return (
    <Screen>
      <HiddenTabHeader title={t('screens.homeCards', { ns: 'settings' })} />
      <Card style={styles.list}>
        {prefs.order.map((id, i) => {
          const shown = !prefs.hidden.includes(id);
          return (
            <View
              key={id}
              style={[styles.row, i > 0 && { borderTopColor: colors.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}
              accessibilityLabel={t('cards.position', { card: name(id), n: i + 1, total: HOME_CARD_IDS.length })}>
              <AppText variant="bodyStrong" muted={!shown} style={styles.name}>
                {name(id)}
              </AppText>
              <MoveButton direction="up" label={t('cards.moveUp', { card: name(id) })} disabled={i === 0} onPress={() => move(id, -1)} />
              <MoveButton
                direction="down"
                label={t('cards.moveDown', { card: name(id) })}
                disabled={i === prefs.order.length - 1}
                onPress={() => move(id, 1)}
              />
              <Switch
                accessibilityLabel={name(id)}
                value={shown}
                onValueChange={(value) => setHidden(id, !value)}
                trackColor={{ false: colors.switchOff, true: colors.primary }}
                thumbColor={shown ? colors.primaryForeground : colors.card}
              />
            </View>
          );
        })}
      </Card>
      <Details>{t('cards.lead')}</Details>
      {isDefaultHomeCards(prefs) ? null : <Button label={t('cards.reset')} icon="refresh" variant="secondary" onPress={reset} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 0, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: HIT + 8 },
  name: { flex: 1, marginRight: spacing.xs },
  move: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  moveDisabled: { opacity: 0.3 },
});
