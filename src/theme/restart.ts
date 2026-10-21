import * as Updates from 'expo-updates';
import { DevSettings } from 'react-native';

/**
 * Restarts the JavaScript app, from the first line: every module, every `StyleSheet`, the navigators and the native bars
 * start over from what the kv store holds. Used after a theme change, so nothing keeps the old theme's colors or fonts.
 *
 * Release builds reload through expo-updates (the same bundle, or the newest one it has downloaded). A build with updates
 * disabled (a development client, Expo Go) has no `reloadAsync`, so it falls back to React Native's dev reload.
 */
export async function restartApp(): Promise<void> {
  if (!__DEV__) {
    try {
      await Updates.reloadAsync();
      return;
    } catch {
      // Updates disabled in this build: reload what React Native can.
    }
  }
  DevSettings.reload();
}
