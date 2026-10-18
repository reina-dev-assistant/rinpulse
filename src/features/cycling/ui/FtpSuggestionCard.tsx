import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { useAnalysisContext } from '@/features/workouts/analysis/ui/context';
import { Card, Note, Txt } from '@/features/workouts/analysis/ui/primitives';
import { fmtInt } from '@/i18n';

import type { FtpSuggestion } from '../types';
import { ftpSuggestionDiffers } from './format';

interface Props {
  suggestion: FtpSuggestion;
  ftp: number | null;
  onUse?: (watts: number) => void;
}

/** The FTP the best 20 minutes point at. Only a suggestion: the FTP changes when the person taps Use, never on its own. */
function FtpSuggestionCardImpl({ suggestion, ftp, onUse }: Props) {
  const { palette } = useAnalysisContext();
  const { t } = useTranslation('cycling');
  if (!ftpSuggestionDiffers(suggestion.watts, ftp)) return null;
  return (
    <Card title={t('section.ftp')}>
      <View style={styles.row}>
        <View style={styles.text}>
          <View style={styles.valueRow}>
            <Txt size={26} bold color={palette.power}>
              {t('ftpSuggestion.value', { value: fmtInt(suggestion.watts) })}
            </Txt>
          </View>
          <Txt size={12} muted>
            {t('ftpSuggestion.body', { best: fmtInt(suggestion.best20Watts) })}
          </Txt>
          <Txt size={12} muted>
            {ftp !== null ? t('ftpSuggestion.current', { value: fmtInt(ftp) }) : t('ftpSuggestion.unset')}
          </Txt>
        </View>
        {onUse ? <Button label={t('ftpSuggestion.use')} variant="primary" onPress={() => onUse(suggestion.watts)} /> : null}
      </View>
      <Note>{t('ftpSuggestion.hint')}</Note>
    </Card>
  );
}

export const FtpSuggestionCard = memo(FtpSuggestionCardImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline' },
});
