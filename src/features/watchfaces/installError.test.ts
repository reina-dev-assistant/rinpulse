import { describe, expect, it } from 'bun:test';

import { installFailureText, isSignatureRefusal } from './installError';

describe('watch face install refusal', () => {
  it('recognises code 100014 in the native message', () => {
    expect(isSignatureRefusal('The watch refused the face before the upload (code 100014). Huawei Health treats ...')).toBe(true);
  });

  it('does not match other codes or longer numbers', () => {
    expect(isSignatureRefusal('refused with code 100015')).toBe(false);
    expect(isSignatureRefusal('code 1000141')).toBe(false);
    expect(isSignatureRefusal('Bluetooth link lost')).toBe(false);
  });

  it('swaps only the signature refusal for the friendly text', () => {
    expect(installFailureText('code 100014', 'friendly')).toBe('friendly');
    expect(installFailureText('Bluetooth link lost', 'friendly')).toBe('Bluetooth link lost');
  });
});
