import Storage from 'expo-sqlite/kv-store';

const DISCONNECTED_BY_USER_KEY = 'watch.disconnectedByUser';

/** Remembers that the person tapped Disconnect (or that they connected again), across launches. A storage failure only loses the memory. */
export async function setDisconnectedByUser(value: boolean): Promise<void> {
  try {
    if (value) await Storage.setItem(DISCONNECTED_BY_USER_KEY, '1');
    else await Storage.removeItem(DISCONNECTED_BY_USER_KEY);
  } catch {
    // The reconnect then behaves as if the person had not disconnected, which is the default.
  }
}

export async function isDisconnectedByUser(): Promise<boolean> {
  try {
    return (await Storage.getItem(DISCONNECTED_BY_USER_KEY)) === '1';
  } catch {
    return false;
  }
}
