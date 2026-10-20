import { MAP_INK } from '@/features/routes/map/mapConfig';
import type { MapLibre } from '@/features/routes/map/maplibre';

/** Line widths by zoom (dp): thin when the whole city is in view, full when the streets are. */
const width = (low: number, high: number): ['interpolate', ['linear'], ['zoom'], number, number, number, number] => [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  low,
  16,
  high,
];

interface LoopLayersProps {
  maplibre: MapLibre;
  /** The person's past tracks, drawn as thin lines under everything. */
  history: GeoJSON.FeatureCollection;
  historyColor: string;
  /** The new loop, solid with an outline and arrows along it. Null while there is none. */
  loop: GeoJSON.FeatureCollection | null;
  loopColor: string;
  /** One point with a `label` property: the start dot and its caption. Null while the start is not known. */
  start: GeoJSON.FeatureCollection | null;
}

/** Past tracks, the loop and the start marker as map layers, in this order (later is on top). Ids are fixed: MapLibre freezes them. */
export function LoopLayers({ maplibre, history, historyColor, loop, loopColor, start }: LoopLayersProps) {
  const { GeoJSONSource, Layer } = maplibre;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return (
    <>
      <GeoJSONSource id="loop-history" data={history}>
        <Layer id="loop-history-casing" type="line" layout={round} paint={{ 'line-color': MAP_INK.casing, 'line-width': 5, 'line-opacity': 0.45 }} />
        <Layer id="loop-history-stroke" type="line" layout={round} paint={{ 'line-color': historyColor, 'line-width': 3, 'line-opacity': 0.75 }} />
      </GeoJSONSource>
      {loop ? (
        <GeoJSONSource id="loop-route" data={loop}>
          <Layer
            id="loop-route-halo"
            type="line"
            layout={round}
            paint={{ 'line-color': MAP_INK.casing, 'line-width': width(6, 13), 'line-opacity': 0.8 }}
          />
          <Layer
            id="loop-route-casing"
            type="line"
            layout={round}
            paint={{ 'line-color': MAP_INK.outline, 'line-width': width(4.5, 10) }}
          />
          <Layer
            id="loop-route-stroke"
            type="line"
            layout={round}
            paint={{ 'line-color': loopColor, 'line-width': width(2.5, 6) }}
          />
          <Layer
            id="loop-route-arrows"
            type="symbol"
            minzoom={13}
            layout={{
              'symbol-placement': 'line',
              'symbol-spacing': 80,
              'text-field': '\u203A',
              'text-font': ['Noto Sans Bold'],
              'text-size': 24,
              'text-keep-upright': false,
              'text-rotation-alignment': 'map',
              'text-pitch-alignment': 'map',
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{ 'text-color': MAP_INK.outline, 'text-halo-color': MAP_INK.casing, 'text-halo-width': 1.2 }}
          />
        </GeoJSONSource>
      ) : null}
      {start ? (
        <GeoJSONSource id="loop-start" data={start}>
          <Layer id="loop-start-halo" type="circle" paint={{ 'circle-radius': 13, 'circle-color': MAP_INK.casing, 'circle-opacity': 0.9 }} />
          <Layer
            id="loop-start-dot"
            type="circle"
            paint={{ 'circle-radius': 8, 'circle-color': loopColor, 'circle-stroke-width': 3.5, 'circle-stroke-color': MAP_INK.outline }}
          />
          <Layer
            id="loop-start-label"
            type="symbol"
            layout={{
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 12,
              'text-anchor': 'top',
              'text-offset': [0, 1.6],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{ 'text-color': MAP_INK.chipText, 'text-halo-color': MAP_INK.casing, 'text-halo-width': 2 }}
          />
        </GeoJSONSource>
      ) : null}
    </>
  );
}
