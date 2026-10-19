import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { COMMENT_IMAGE_QUALITY, commentImageResize } from '@/features/social/commentImage';
import { t } from '@/i18n';

/** A comment photo ready to go up: a re-encoded JPEG (the re-encode drops the EXIF block, GPS included). */
export interface CommentImage {
  /** Local file, for the preview in the composer. */
  uri: string;
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

/**
 * Opens the gallery and returns the pick shrunk to `COMMENT_IMAGE_SIDE` as a JPEG. `null` when the person backs out.
 * Throws what the picker or the manipulator throws. The system gallery needs no photo permission.
 */
export async function pickCommentImage(): Promise<CommentImage | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0]!;
  const context = ImageManipulator.manipulate(asset.uri);
  const resize = commentImageResize(asset.width, asset.height);
  const rendered = await (resize ? context.resize(resize) : context).renderAsync();
  const saved = await rendered.saveAsync({ base64: true, compress: COMMENT_IMAGE_QUALITY, format: SaveFormat.JPEG });
  if (!saved.base64) throw new Error(t('social:comments.attach.imageFailed'));
  return { uri: saved.uri, base64: saved.base64, mimeType: 'image/jpeg', width: saved.width, height: saved.height };
}
