import Storage from 'expo-sqlite/kv-store';

import { notePrefChanged } from '@/cloud/prefsSync';

import { DEFAULT_WHEEL_CIRCUMFERENCE_MM } from './gatt';

const WHEEL_KEY = 'joyofit.wheelMm';

/** Rolling circumference of the bike's wheel in millimetres (what a speed sensor's revolutions are multiplied by). */
export function getWheelMm(): number {
  const value = Number(Storage.getItemSync(WHEEL_KEY));
  return Number.isFinite(value) && value >= 1000 && value <= 3000 ? value : DEFAULT_WHEEL_CIRCUMFERENCE_MM;
}

export function setWheelMm(mm: number): void {
  Storage.setItemSync(WHEEL_KEY, String(Math.round(Math.min(3000, Math.max(1000, mm)))));
  void notePrefChanged('wheel');
}
