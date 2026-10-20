import { describe, expect, it } from 'bun:test';

import { deleteScaleSecret, loadScaleSecret, saveScaleSecret, scaleSecretKey, type SecretStore } from './secret';

function memoryStore(): SecretStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItemAsync: async (key) => items.get(key) ?? null,
    setItemAsync: async (key, value) => void items.set(key, value),
    deleteItemAsync: async (key) => void items.delete(key),
  };
}

describe('scale secrets', () => {
  it('keys by scale with only characters the secure store accepts', () => {
    expect(scaleSecretKey('DC:23:53:DC:E1:95')).toBe('joyofit.scale.secret.DC_23_53_DC_E1_95');
    expect(scaleSecretKey('6F1A2B3C-0000-4000-8000-ABCDEF012345')).toBe('joyofit.scale.secret.6F1A2B3C-0000-4000-8000-ABCDEF012345');
    expect(scaleSecretKey('DC:23:53:DC:E1:95')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
  it('saves, loads and deletes one secret per scale', async () => {
    const store = memoryStore();
    expect(await loadScaleSecret(store, 'AA:BB')).toBeNull();
    await saveScaleSecret(store, 'AA:BB', 'TestKey012345678');
    await saveScaleSecret(store, 'CC:DD', 'other-key-123456');
    expect(await loadScaleSecret(store, 'AA:BB')).toBe('TestKey012345678');
    await deleteScaleSecret(store, 'AA:BB');
    expect(await loadScaleSecret(store, 'AA:BB')).toBeNull();
    expect(await loadScaleSecret(store, 'CC:DD')).toBe('other-key-123456');
  });
});
