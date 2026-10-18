import { describe, expect, it } from 'bun:test';

import { avatarUploadInput, cropSquare, isPermissionError, isUploadedAvatar } from './avatar';

describe('cropSquare', () => {
  it('a landscape picture loses equal strips left and right', () => {
    expect(cropSquare(1600, 1000)).toEqual({ originX: 300, originY: 0, width: 1000, height: 1000 });
  });

  it('a portrait picture loses equal strips top and bottom', () => {
    expect(cropSquare(900, 1200)).toEqual({ originX: 0, originY: 150, width: 900, height: 900 });
  });

  it('a square picture is taken whole', () => {
    expect(cropSquare(512, 512)).toEqual({ originX: 0, originY: 0, width: 512, height: 512 });
  });

  it('an odd difference rounds the origin down and stays inside the picture', () => {
    const crop = cropSquare(1001, 1000)!;
    expect(crop).toEqual({ originX: 0, originY: 0, width: 1000, height: 1000 });
    const odd = cropSquare(1003, 1000)!;
    expect(odd.originX).toBe(1);
    expect(odd.originX + odd.width).toBeLessThanOrEqual(1003);
  });

  it('fractional sizes are floored to whole pixels', () => {
    expect(cropSquare(800.7, 600.2)).toEqual({ originX: 100, originY: 0, width: 600, height: 600 });
  });

  it('a size that is zero, negative or not a number gives no crop', () => {
    expect(cropSquare(0, 600)).toBeNull();
    expect(cropSquare(800, -1)).toBeNull();
    expect(cropSquare(Number.NaN, 600)).toBeNull();
    expect(cropSquare(800, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('avatarUploadInput', () => {
  it('is the JPEG body avatar.upload takes', () => {
    expect(avatarUploadInput('QUJD')).toEqual({ imageBase64: 'QUJD', mimeType: 'image/jpeg' });
  });

  it('nothing rendered means nothing to upload', () => {
    expect(avatarUploadInput('')).toBeNull();
    expect(avatarUploadInput(null)).toBeNull();
    expect(avatarUploadInput(undefined)).toBeNull();
  });
});

describe('isUploadedAvatar', () => {
  const id = '0123456789abcdef0123456789abcdef';

  it('a photo uploaded to JoyoRogo can be removed', () => {
    expect(isUploadedAvatar(`/avatar/user_1/${id}.jpg`)).toBe(true);
    expect(isUploadedAvatar(`/avatar/user_1/${id}.png`)).toBe(true);
    expect(isUploadedAvatar(`/avatar/user_1/${id}.webp`)).toBe(true);
  });

  it('a Google photo, no photo, or anything else cannot', () => {
    expect(isUploadedAvatar('https://lh3.googleusercontent.com/a/abc=s96-c')).toBe(false);
    expect(isUploadedAvatar(null)).toBe(false);
    expect(isUploadedAvatar(undefined)).toBe(false);
    expect(isUploadedAvatar('')).toBe(false);
    expect(isUploadedAvatar(`/avatar/user_1/${id}.gif`)).toBe(false);
    expect(isUploadedAvatar('/avatar/user_1/short.jpg')).toBe(false);
    expect(isUploadedAvatar(`https://joyorogo.com/avatar/user_1/${id}.jpg`)).toBe(false);
  });
});

describe('isPermissionError', () => {
  it('knows the picker refusing by its code or its text', () => {
    expect(isPermissionError(Object.assign(new Error('x'), { code: 'ERR_USER_REJECTED_PERMISSIONS' }))).toBe(true);
    expect(isPermissionError(new Error('Missing camera or camera roll permission'))).toBe(true);
  });

  it('other failures are not a refusal', () => {
    expect(isPermissionError(new Error('Network request failed'))).toBe(false);
    expect(isPermissionError('boom')).toBe(false);
    expect(isPermissionError(null)).toBe(false);
  });
});
