import HuaweiWear from '../modules/huawei-wear';

export * from '../modules/huawei-wear';
export { HuaweiWear };

/**
 * OTA bundles can run on older installed binaries whose native module lacks newer functions.
 * Call sites for functions added after a release MUST gate on this.
 */
export function hasNative(name: string): boolean {
  try {
    return typeof (HuaweiWear as unknown as Record<string, unknown>)[name] === 'function';
  } catch {
    return false;
  }
}
