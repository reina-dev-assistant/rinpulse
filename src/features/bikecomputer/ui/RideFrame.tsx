import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { RidePage } from '../types';
import { AlertBanner } from './AlertBanner';
import { ControlBar } from './ControlBar';
import type { RidePalette } from './ridePalette';
import { StatusStrip } from './StatusStrip';

export interface FrameAlert {
  text: string;
  tone: 'urgent' | 'quiet';
  onDismiss: () => void;
  /** Changes with every alert, so a new one fades in again. */
  key: string | number;
}

interface RideFrameProps {
  palette: RidePalette;
  landscape: boolean;
  insets: { top: number; bottom: number; left: number; right: number };
  status: Omit<ComponentProps<typeof StatusStrip>, 'palette'>;
  pages: readonly RidePage[];
  /** `active` is true for the page in view and its neighbours: heavy pages (the map) mount only then. `width` is the page width. */
  renderPage: (page: RidePage, active: boolean, width: number) => ReactNode;
  controls: Omit<ComponentProps<typeof ControlBar>, 'palette' | 'column'>;
  alert: FrameAlert | null;
  /** The persistent off-course sentence; null while on course. */
  offCourseText: string | null;
  /** Any touch, for the dimming; the touch itself still goes on to the controls and the pages. */
  onTouch?: () => void;
  /** Start on this page (screenshots); the ride starts on the first. */
  initialPage?: number;
}

/**
 * The chrome of the ride screen: status strip, alert banners over the pages, the horizontally paged pages, a page indicator, and the control
 * bar (a row below, or a column at the right edge in landscape). It holds no ride data; `BikeRideView` feeds it.
 */
export function RideFrame({ palette, landscape, insets, status, pages, renderPage, controls, alert, offCourseText, onTouch, initialPage = 0 }: RideFrameProps) {
  const { t } = useTranslation('bikecomp');
  const [pager, setPager] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(initialPage);
  const list = useRef<FlatList<RidePage>>(null);
  const current = Math.min(page, Math.max(pages.length - 1, 0));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPager((old) => (old.width === width && old.height === height ? old : { width, height }));
  };

  // After a rotation the offset of the page in view changes with the width.
  useEffect(() => {
    if (pager.width > 0) list.current?.scrollToOffset({ offset: pager.width * current, animated: false });
  }, [pager.width, current]);

  const onEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pager.width > 0) setPage(Math.round(event.nativeEvent.contentOffset.x / pager.width));
  };

  const side = { paddingLeft: insets.left, paddingRight: landscape ? 0 : insets.right };

  return (
    <View onTouchStart={onTouch} style={[styles.root, { backgroundColor: palette.background }, landscape && styles.rootRow]}>
      <View style={[styles.main, { paddingTop: insets.top, paddingBottom: landscape ? insets.bottom : 0 }, side]}>
        <StatusStrip palette={palette} {...status} />
        {/* In the flow, above the pages: an alert shrinks the data grid, it never covers a number. */}
        {offCourseText !== null || alert ? (
          <View>
            {offCourseText !== null ? <AlertBanner text={offCourseText} tone="danger" palette={palette} /> : null}
            {alert ? <AlertBanner key={alert.key} text={alert.text} tone={alert.tone} palette={palette} onDismiss={alert.onDismiss} /> : null}
          </View>
        ) : null}
        <View style={styles.pager} onLayout={onLayout}>
          {pager.width > 0 ? (
            <FlatList
              ref={list}
              data={pages}
              horizontal
              pagingEnabled
              bounces={false}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              getItemLayout={(_, index) => ({ length: pager.width, offset: pager.width * index, index })}
              extraData={[current, pager.width, pager.height]}
              initialNumToRender={2}
              windowSize={3}
              onMomentumScrollEnd={onEnd}
              renderItem={({ item, index }) => (
                <View style={{ width: pager.width, height: pager.height }}>{renderPage(item, Math.abs(index - current) <= 1, pager.width)}</View>
              )}
            />
          ) : null}
        </View>
        {pages.length > 1 ? (
          <View accessible accessibilityLabel={t('page.indicator', { current: current + 1, total: pages.length })} style={styles.dots}>
            {pages.map((item, index) => (
              <View key={item.id} style={[styles.dot, index === current ? [styles.dotOn, { backgroundColor: palette.foreground }] : { backgroundColor: palette.hairline }]} />
            ))}
          </View>
        ) : null}
        {landscape ? null : <ControlBar palette={palette} column={false} {...controls} />}
      </View>
      {landscape ? (
        <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom, paddingRight: insets.right, backgroundColor: palette.background }}>
          <ControlBar palette={palette} column {...controls} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootRow: { flexDirection: 'row' },
  main: { flex: 1 },
  pager: { flex: 1 },
  dots: { height: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { width: 22 },
});
