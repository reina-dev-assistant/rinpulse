import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Details } from '@/components/Details';
import { Section, Screen } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { showsWatchUi } from '@/features/device/presence';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { ensureBluetoothConnect, ensureBluetoothScan } from '@/features/device/useBluetoothPermission';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { localOnlyMode, setLocalOnlyMode } from '@/features/settings/localOnly';
import { dbHealth, useDbHealth } from '@/db/recovery';
import { errorMessage } from '@/format';
import { useTheme } from '@/theme';
import { hasNative, HuaweiWear } from '@/wear';

export default function AdvancedScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const router = useRouter();
  const presence = useWatchPresence();
  // Courses and the Bluetooth link are for the watch; with none, only the log and About remain.
  const withWatch = presence === null || showsWatchUi(presence);
  const [courses, setCourses] = useState(() => HuaweiWear.getCourses());
  const [coursesBusy, setCoursesBusy] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [forceBle, setForceBle] = useState(() => HuaweiWear.getForceBle());
  const [bleError, setBleError] = useState<string | null>(null);
  // An OTA bundle can run on an installed binary that predates this switch (see `hasNative`), so the row is hidden there.
  const canPinLink = hasNative('getLinkOverride') && hasNative('setLinkOverride');
  const [classicLink, setClassicLink] = useState(() => canPinLink && HuaweiWear.getLinkOverride() === 'BR');

  useNativeRefresh(
    useCallback(() => {
      setCourses(HuaweiWear.getCourses());
      setForceBle(HuaweiWear.getForceBle());
      if (canPinLink) setClassicLink(HuaweiWear.getLinkOverride() === 'BR');
    }, [canPinLink]),
  );

  /**
   * Pins the watch to Bluetooth Classic (RFCOMM), or back to the app's own choice. Android 14+ drops the watch's
   * 514-byte LE notifications, which loses any reply that travels as one — the GPS file's blocks among them — while
   * RFCOMM has no such limit. Bluetooth permission is not needed: the watch is already bonded.
   */
  const toggleClassicLink = async (enabled: boolean) => {
    setBleError(null);
    try {
      await HuaweiWear.setLinkOverride(enabled ? 'BR' : null);
    } catch (e) {
      setBleError(errorMessage(e));
    } finally {
      setClassicLink(HuaweiWear.getLinkOverride() === 'BR');
    }
  };

  const toggleForceBle = async (enabled: boolean) => {
    setBleError(null);
    try {
      if (enabled && ((await ensureBluetoothConnect()) !== 'granted' || (await ensureBluetoothScan()) !== 'granted')) {
        setBleError(t('advanced.bleDenied'));
      }
      await HuaweiWear.setForceBle(enabled);
    } catch (e) {
      setBleError(errorMessage(e));
    } finally {
      setForceBle(HuaweiWear.getForceBle());
    }
  };

  const toggleCourses = async (enabled: boolean) => {
    setCoursesBusy(true);
    setCoursesError(null);
    try {
      await HuaweiWear.setCoursesEnabled(enabled);
    } catch (e) {
      setCoursesError(errorMessage(e));
    } finally {
      setCourses(HuaweiWear.getCourses());
      setCoursesBusy(false);
    }
  };

  const { repairing } = useDbHealth();
  const [repairHealthy, setRepairHealthy] = useState(false);
  const [localOnly, setLocalOnly] = useState(localOnlyMode);

  const toggleLocalOnly = (enabled: boolean) => {
    setLocalOnlyMode(enabled);
    setLocalOnly(enabled);
  };

  const repairNow = async () => {
    setRepairHealthy(false);
    // The result is shown by the repair notice; only "nothing was wrong" has no notice and is said here.
    const result = await dbHealth.repair();
    setRepairHealthy(result.kind === 'healthy');
  };

  return (
    <Screen>
      <View>
        <NavRow
          icon="terminal"
          title={t('index.rows.log.title')}
          subtitle={t('index.rows.log.subtitle')}
          onPress={() => router.push('/settings/log')}
          style={groupedRowStyle(theme, 0, 3)}
        />
        <NavRow
          icon="construct"
          title={t('advanced.repair')}
          subtitle={t('advanced.repairSubtitle')}
          disabled={repairing}
          onPress={() => void repairNow()}
          style={groupedRowStyle(theme, 1, 3)}
        />
        <NavRow
          icon="information-circle"
          title={t('index.rows.about.title')}
          onPress={() => router.push('/settings/about')}
          style={groupedRowStyle(theme, 2, 3)}
        />
      </View>
      {repairHealthy ? <Notice>{t('advanced.repairHealthy')}</Notice> : null}
      {/* Always shown, watch or not: this is the switch that makes the app stop offering an account. */}
      <Section title={t('advanced.localOnly.title')} icon="person-circle" tint="link">
        <SwitchRow
          label={t('advanced.localOnly.label')}
          value={localOnly}
          onValueChange={toggleLocalOnly}
        />
        <Notice icon="information-circle">{t('advanced.localOnly.hint')}</Notice>
      </Section>
      {withWatch ? (
        <Section title={t('advanced.experimental')} icon="flask" tint="workouts">
          <SwitchRow
            label={t('advanced.courses')}
            value={courses.enabled}
            disabled={coursesBusy}
            onValueChange={(enabled) => void toggleCourses(enabled)}
          />
          {coursesError ? <Notice tone="danger">{coursesError}</Notice> : null}
          {canPinLink ? (
            <>
              <SwitchRow
                label={t('advanced.classicLink')}
                value={classicLink}
                onValueChange={(enabled) => void toggleClassicLink(enabled)}
              />
              <Notice icon="information-circle">{t('advanced.classicLinkHint')}</Notice>
            </>
          ) : null}
          {__DEV__ ? (
            <SwitchRow
              label={t('advanced.bleLink')}
              value={forceBle}
              onValueChange={(enabled) => void toggleForceBle(enabled)}
            />
          ) : null}
          {__DEV__ && bleError ? <Notice tone="danger">{bleError}</Notice> : null}
          <Details>
            {__DEV__ ? t('advanced.detailsDev') : t('advanced.details')}
          </Details>
        </Section>
      ) : null}
      {withWatch && courses.enabled ? (
        <NavRow
          icon="walk"
          tint="workouts"
          title={t('advanced.courses')}
          subtitle={t('advanced.coursesSubtitle')}
          onPress={() => router.push('/settings/courses')}
          style={groupedRowStyle(theme, 0, 1)}
        />
      ) : null}
    </Screen>
  );
}
