import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { AVATAR_QUALITY, AVATAR_SIDE, avatarUploadInput, cropSquare, type AvatarUploadInput } from '@/cloud/avatar';
import { t } from '@/i18n';

/**
 * Opens the gallery and returns the pick as the body of `avatar.upload`: a square JPEG of `AVATAR_SIDE` pixels, base64.
 * The system picker already crops to a square (`aspect: [1, 1]`); the center crop here makes sure of it, so the photo is
 * the same shape on every phone. `null` when the person backs out. Throws what the picker or the manipulator throws.
 * The system gallery needs no photo permission on Android or iOS, so nothing is asked here.
 */
export async function pickAvatar(): Promise<AvatarUploadInput | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
    exif: false,
  });
  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0]!;
  const crop = cropSquare(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  // A picker that reports no usable size cannot be cropped here: keep its shape and only shrink it.
  const rendered = await (crop ? context.crop(crop).resize({ width: AVATAR_SIDE, height: AVATAR_SIDE }) : context.resize({ width: AVATAR_SIDE })).renderAsync();
  const saved = await rendered.saveAsync({ base64: true, compress: AVATAR_QUALITY, format: SaveFormat.JPEG });
  const input = avatarUploadInput(saved.base64);
  if (!input) throw new Error(t('settings:account.photo.error.empty'));
  return input;
}
