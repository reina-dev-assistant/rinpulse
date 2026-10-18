import { Redirect, useLocalSearchParams } from 'expo-router';

import { cleanCode } from '@/features/ride/ui/format';

/** `joyofit://ride/join?code=048213`, the QR of the game: opens the room screen with the code filled in. */
export default function RideJoinLink() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <Redirect href={{ pathname: '/ride', params: { code: cleanCode(code ?? '') } }} />;
}
