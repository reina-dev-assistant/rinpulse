import { useRoomCapture } from './useRoomCapture';

/** Mounted once under the providers: runs the thermometer capture (`useRoomCapture`) for as long as the app lives. Renders nothing. */
export function RoomCaptureRunner() {
  useRoomCapture();
  return null;
}
