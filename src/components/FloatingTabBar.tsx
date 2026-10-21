import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { CommonActions } from 'expo-router/react-navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Keyboard, Platform, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import {
  TAB_BAR_BORDER,
  TAB_BAR_GAP_BOTTOM,
  TAB_BAR_GAP_TOP,
  TAB_BAR_MARGIN_X,
  TAB_BAR_PADDING,
  TAB_ICON_BOX,
  TAB_ITEM_PADDING,
  tabBarContentHeight,
  tabBarPillHeight,
  tabBarRadius,
  tabItemRadius,
} from '@/components/tabBarMetrics';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { HIT, useTheme } from '@/theme';

/** Glyph size handed to `tabBarIcon`; the icon box in `tabBarMetrics` is built for it. */
const ICON_SIZE = 25;
const INDICATOR_MS = 140;

/** True while the Android keyboard is up. The window resizes with it, so a visible bar would ride above the keyboard; iOS keeps it. */
function useAndroidKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

interface ItemProps {
  focused: boolean;
  radius: number;
  height: number;
  accessibilityLabel?: string;
  onPress: () => void;
  onLongPress: () => void;
  testID?: string;
  children: ReactNode;
}

/** One tab: the active background (`muted`) fades and settles in behind the icon and label; the item shrinks to 0.96 while pressed. */
function FloatingTabItem({ focused, radius, height, accessibilityLabel, onPress, onLongPress, testID, children }: ItemProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(focused ? 1 : 0));
  useEffect(() => {
    if (reduced) {
      progress.setValue(focused ? 1 : 0);
      return;
    }
    const run = Animated.timing(progress, { toValue: focused ? 1 : 0, duration: INDICATOR_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [focused, progress, reduced]);

  return (
    <PressableScale
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      scaleTo={0.96}
      style={[styles.item, { height, minHeight: HIT, borderRadius: radius }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colors.muted,
            borderRadius: radius,
            opacity: progress,
            transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          },
        ]}
      />
      {children}
    </PressableScale>
  );
}

/**
 * The floating tab bar: a solid rounded pill inset from the screen edges and lifted above the bottom inset. It is absolutely positioned over
 * the screen (`TabBarWithLive`): content scrolls behind and below it, and every scrolling screen pads the end of its content by the covered
 * height (`tabBarInset`). Only the visible tabs are drawn; routes hidden with
 * `href: null` carry `tabBarItemStyle.display === 'none'`. Draws nothing where the focused route hides the bar
 * (`tabBarStyle.display === 'none'`) and, on Android, while the keyboard is open.
 */
export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors, radius } = useTheme();
  const { fontScale } = useWindowDimensions();
  const keyboardOpen = useAndroidKeyboardOpen();

  const focusedOptions = descriptors[state.routes[state.index].key].options;
  const hiddenByRoute = StyleSheet.flatten(focusedOptions.tabBarStyle as StyleProp<ViewStyle>)?.display === 'none';
  if (hiddenByRoute || keyboardOpen) return null;

  const itemHeight = tabBarContentHeight(fontScale);
  const pillHeight = tabBarPillHeight(fontScale);
  const barRadius = tabBarRadius(radius.bar, pillHeight);
  const itemRadius = tabItemRadius(barRadius, itemHeight);

  return (
    <View pointerEvents="box-none" style={[styles.strip, { paddingBottom: TAB_BAR_GAP_BOTTOM + Math.max(0, insets.bottom) }]}>
      <View
        accessibilityRole="tablist"
        style={[
          styles.pill,
          {
            height: pillHeight,
            borderRadius: barRadius,
            backgroundColor: colors.card,
            borderColor: colors.hairline,
            shadowColor: '#000',
          },
        ]}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          if (StyleSheet.flatten(options.tabBarItemStyle as StyleProp<ViewStyle>)?.display === 'none') return null;
          const focused = index === state.index;
          const color = focused ? colors.primary : colors.mutedForeground;
          const title = options.title ?? route.name;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.dispatch({ ...CommonActions.navigate(route), target: state.key });
            }
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
          const label = options.tabBarLabel;
          return (
            <FloatingTabItem
              key={route.key}
              focused={focused}
              radius={itemRadius}
              height={itemHeight}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}>
              {options.tabBarIcon ? <View style={styles.icon}>{options.tabBarIcon({ focused, color, size: ICON_SIZE })}</View> : null}
              {typeof label === 'function' ? label({ focused, color, position: 'below-icon', children: title }) : null}
            </FloatingTabItem>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { paddingTop: TAB_BAR_GAP_TOP, paddingHorizontal: TAB_BAR_MARGIN_X },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: TAB_BAR_PADDING,
    borderWidth: TAB_BAR_BORDER,
    // One restrained lift: a soft, short shadow (iOS) or elevation 6 (Android); no glow. The pill floats over the content, so it needs the lift.
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: TAB_ITEM_PADDING },
  icon: { height: TAB_ICON_BOX, alignItems: 'center', justifyContent: 'center' },
});
