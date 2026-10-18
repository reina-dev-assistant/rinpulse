import Storage from 'expo-sqlite/kv-store';

const KEY = 'joyofit.sensorsIntro';

/** Whether the person already pressed "Lanjut" on the sensor search explanation, so it is not shown again. */
export function sensorIntroSeen(): boolean {
  return Storage.getItemSync(KEY) === '1';
}

export function markSensorIntroSeen(): void {
  Storage.setItemSync(KEY, '1');
}
