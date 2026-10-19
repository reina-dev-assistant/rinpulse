import { JOYOROGO_URL } from '@/cloud/config';

/** Where a comment's photo (an image attachment, or a food log's photo) is served; send the session cookie with it. */
export function commentPhotoUrl(commentId: string): string {
  return `${JOYOROGO_URL}/comment-photo/${encodeURIComponent(commentId)}`;
}

/** A photo preview in the picker (`/photo/<photoId>` is the owner's own food photo). */
export function ownPhotoUrl(photoId: string): string {
  return `${JOYOROGO_URL}/photo/${encodeURIComponent(photoId)}`;
}
