import type { PickingInfo } from "@deck.gl/core";
import type { _Tile2DHeader as Tile2DHeader, TileLayerPickingInfo } from "@deck.gl/geo-layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PICK_RADIUS_PX } from "../shared/config";
import { describeFeature } from "../shared/hit";
import { createMap } from "../shared/map";
import { type ColorMode, createPanel, describeHit, type Shape, tileStats } from "../shared/ui";
import { type FlightsLayer, flightsLayer } from "./layer";
import { type DeckTile, featureIdAt } from "./tile";

const map = createMap(document.getElementById("map")!);
const state: { colorMode: ColorMode; shape: Shape } = { colorMode: "altitude", shape: "lines" };

const layers = () => [flightsLayer({ ...state, onViewportLoad })];
const overlay = new MapboxOverlay({
  interleaved: true,
  pickingRadius: PICK_RADIUS_PX,
  layers: layers(),
  onHover,
});
map.addControl(overlay);
// For poking at the renderer from the console during development.
if (import.meta.env.DEV) Object.assign(window, { map, overlay });

function update(next: Partial<typeof state>): void {
  Object.assign(state, next);
  overlay.setProps({ layers: layers() });
}

const panel = createPanel(document.body, {
  ribbons: "extruded by deck.gl's PathLayer",
  note: "Each tile's decoded <code>Int32Array</code> is a stock <code>PathLayer</code>'s positions; a per-tile matrix places it on the map. MapLibre + deck.gl.",
  other: { label: "Three.js version", href: "threejs.html" },
  onColorMode: (colorMode) => update({ colorMode }),
  onShape: (shape) => update({ shape }),
});

/**
 * The tooltip text of the feature last hovered. deck.gl reports a hover every frame the cursor
 * moves; the text changes only with the feature, or with the tiles in view (`onViewportLoad`).
 */
let lastHit: { featureId: number; lines: string[] } | null = null;

/** The tooltip; the layer highlights the hovered feature by itself (`_updateAutoHighlight`). */
function onHover(info: PickingInfo): void {
  const { tile, index, layer, x, y } = info as TileLayerPickingInfo<DeckTile | null>;
  const content = tile?.content;
  if (!content || index < 0) {
    lastHit = null;
    panel.setTooltip(null);
    return;
  }
  const featureId = featureIdAt(content, index);
  if (lastHit?.featureId !== featureId) {
    const tiles = (layer as FlightsLayer).drawnTiles();
    lastHit = { featureId, lines: describeHit(describeFeature(content.tile, index, tiles)) };
  }
  panel.setTooltip({ x, y, lines: lastHit.lines });
}

function onViewportLoad(tiles: Tile2DHeader<DeckTile | null>[]): void {
  lastHit = null;
  panel.setStats(tileStats(tiles.flatMap((t) => (t.content ? [t.content.tile] : []))));
}
