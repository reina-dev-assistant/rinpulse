import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

/**
 * The height to lift a screen's bottom bar by so the on-screen keyboard does not cover it. `KeyboardAvoidingView` takes
 * its frame relative to the parent, so under a native header or tab bar it lifts too little; this measures the box in the
 * window instead. Attach `ref` to the box that ends at the bottom of the usable area and pad that box by the result.
 */
export function useKeyboardOverlap() {
  const ref = useRef<View>(null);
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      ref.current?.measureInWindow((_x, y, _w, h) => setLift(Math.max(0, Math.round(y + h - e.endCoordinates.screenY))));
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setLift(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return { ref, lift };
}
