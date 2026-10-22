import { describe, expect, it } from 'bun:test';

import type { SecretStore } from '@/features/scale/secret';

import { bindkeyKey, forgetLink, getLink, linkKey, loadBindkey, saveBindkey, setLink, type KvStore } from './link';

class MemoryKv implements KvStore {
  readonly map = new Map<string, string>();
  getItemSync = (key: string): string | null => this.map.get(key) ?? null;
  setItemSync = (key: string, value: string): void => void this.map.set(key, value);
  removeItemSync = (key: string): boolean => this.map.delete(key);
}

class MemorySecrets implements SecretStore {
  readonly map = new Map<string, string>();
  getItemAsync = async (key: string): Promise<string | null> => this.map.get(key) ?? null;
  setItemAsync = async (key: string, value: string): Promise<void> => void this.map.set(key, value);
  deleteItemAsync = async (key: string): Promise<void> => void this.map.delete(key);
}

const ID = 'A4:C1:38:02:83:F4';
const KEY = 'e9ea895fac7cca6d30532432a516f3a8';

describe('room link', () => {
  it('is advert until set, and advert again when set back', () => {
    const kv = new MemoryKv();
    expect(getLink(kv, ID)).toBe('advert');
    setLink(kv, ID, 'bindkey');
    expect(getLink(kv, ID)).toBe('bindkey');
    setLink(kv, ID, 'gatt');
    expect(getLink(kv, ID)).toBe('gatt');
    setLink(kv, ID, 'advert');
    expect(getLink(kv, ID)).toBe('advert');
    expect(kv.map.size).toBe(0);
  });

  it('treats an unknown stored value as advert', () => {
    const kv = new MemoryKv();
    kv.setItemSync(linkKey(ID), 'weird');
    expect(getLink(kv, ID)).toBe('advert');
  });

  it('uses secure store keys without colons, one per sensor', () => {
    expect(bindkeyKey(ID)).toBe('joyofit.room.bindkey.A4_C1_38_02_83_F4');
    expect(bindkeyKey('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(bindkeyKey(ID)).not.toBe(bindkeyKey('A4:C1:38:02:83:F5'));
  });

  it('keeps the bind key in the secret store only and removes it with the pairing', async () => {
    const kv = new MemoryKv();
    const secrets = new MemorySecrets();
    setLink(kv, ID, 'bindkey');
    await saveBindkey(secrets, ID, KEY);
    expect(await loadBindkey(secrets, ID)).toBe(KEY);
    expect([...kv.map.values()].join('')).not.toContain(KEY);
    await forgetLink(kv, secrets, ID);
    expect(await loadBindkey(secrets, ID)).toBeNull();
    expect(getLink(kv, ID)).toBe('advert');
  });
});
