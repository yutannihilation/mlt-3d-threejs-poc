import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_STYLE, DATA_ATTRIBUTION, INITIAL_VIEW, TILE_MIN_ZOOM } from "./config";

/** The basemap both renderers draw on, with the camera kept in the URL hash. */
export function createMap(container: HTMLElement): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: BASEMAP_STYLE,
    ...INITIAL_VIEW,
    // There are no tiles below TILE_MIN_ZOOM.
    minZoom: TILE_MIN_ZOOM,
    maxPitch: 85,
    // MSAA for the shared WebGL context; thin, nearly horizontal lines look dashed without it.
    canvasContextAttributes: { antialias: true },
    hash: true,
    attributionControl: { compact: false, customAttribution: DATA_ATTRIBUTION },
  });
  map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
  return map;
}
