import type { FieldContext } from '../fields/values';
import { fieldValue } from '../fields/values';
import type { FieldId, FieldValue, NavSnapshot, RidePage } from '../types';
import { ClimbPage } from './ClimbPage';
import type { ElevationPoint } from './elevationGeometry';
import { FieldGrid } from './FieldGrid';
import { LapsPage, type LapRowData } from './LapsPage';
import { MapPage } from './MapPage';
import type { RidePalette } from './ridePalette';

const WAITING: FieldValue = { value: '--', unit: null, tone: 'neutral', sub: null };

interface RidePageContentProps {
  page: RidePage;
  /** The page is in view or next to it: the map mounts only then. */
  active: boolean;
  width: number;
  palette: RidePalette;
  ctx: FieldContext | null;
  nav: NavSnapshot | null;
  hasRoute: boolean;
  elevation: readonly ElevationPoint[] | null;
  route: readonly { lat: number; lon: number }[] | null;
  position: { lat: number; lon: number; headingDeg: number | null } | null;
  laps: readonly LapRowData[];
}

/** What one page of the ride shows, whatever its kind. */
export function RidePageContent({ page, active, width, palette, ctx, nav, hasRoute, elevation, route, position, laps }: RidePageContentProps) {
  switch (page.kind) {
    case 'fields':
      return (
        <FieldGrid
          fields={page.fields}
          grid={page.grid}
          palette={palette}
          resolve={(id: FieldId) => (ctx ? fieldValue(id, ctx) : WAITING)}
        />
      );
    case 'map':
      return active ? <MapPage ctx={ctx} nav={nav} route={route} position={position} palette={palette} /> : null;
    case 'climb':
      return <ClimbPage nav={nav} hasRoute={hasRoute} elevationStrip={elevation} palette={palette} />;
    case 'laps':
      return (
        <LapsPage
          laps={laps}
          width={width}
          palette={palette}
          current={ctx ? { number: ctx.live.lapNumber, time: fieldValue('lapTime', ctx), distance: fieldValue('lapDistance', ctx) } : null}
        />
      );
  }
}
