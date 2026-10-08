import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_STYLE, DATA_ATTRIBUTION, INITIAL_VIEW, TILE_MIN_ZOOM } from "./config";
import { LinesLayer } from "./layer";
import { createPanel, describeHit } from "./ui";

const container = document.getElementById("map")!;
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

const panel = createPanel(
  document.body,
  (mode) => {
    lines.colorMode = mode;
    map.triggerRepaint();
  },
  (shape) => {
    lines.shape = shape;
    map.triggerRepaint();
  },
);
const lines = new LinesLayer((stats) => panel.setStats(stats));
map.on("load", () => map.addLayer(lines));
// For poking at the renderer from the console during development.
if (import.meta.env.DEV) Object.assign(window, { map, lines });

// One pick in flight at a time; the latest cursor position wins.
let pending: { x: number; y: number } | null = null;
let picking = false;
map.on("mousemove", (e) => {
  pending = e.point;
  void pickPending();
});
map.getCanvas().addEventListener("mouseleave", () => {
  pending = null;
  panel.setTooltip(null);
});

async function pickPending(): Promise<void> {
  if (picking || !pending || !map.getLayer(lines.id)) return;
  picking = true;
  try {
    while (pending) {
      const { x, y } = pending;
      pending = null;
      const hit = await lines.pick(x, y);
      panel.setTooltip(hit && { x, y, lines: describeHit(hit) });
    }
  } finally {
    picking = false;
  }
}
