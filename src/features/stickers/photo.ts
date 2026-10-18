import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { ImageRef } from './core/resolve';
import { photoTargetSize, PHOTO_MAX_SIDE } from './photoSize';

/** Quality 1 keeps the pick lossless; `prepare` makes the one JPEG the sticker uses, so the original is read once. */
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };

/** The source of a sticker photo. */
export type PhotoSource = 'library' | 'camera';

/**
 * Asks the picker (or camera) for a photo and returns it downscaled to `PHOTO_MAX_SIDE` as a JPEG (0.9) when it was bigger,
 * or as picked when it was not. `null` when the person backs out. Throws what the picker throws (permission, no camera).
 */
export async function pickStickerPhoto(source: PhotoSource): Promise<ImageRef | null> {
  const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS) : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0]!;
  const target = photoTargetSize({ width: asset.width, height: asset.height });
  if (!target.resize) return { uri: asset.uri, width: asset.width, height: asset.height };
  const context = ImageManipulator.manipulate(asset.uri).resize(asset.width >= asset.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}
