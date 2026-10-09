import { COORDINATE_SYSTEM, type Layer, type LayerProps } from "@deck.gl/core";
import {
  type _Tile2DHeader as Tile2DHeader,
  TileLayer,
  type TileLayerPickingInfo,
  type TileLayerProps,
} from "@deck.gl/geo-layers";
import { PathLayer } from "@deck.gl/layers";
import {
  ALTITUDE_RANGE_M,
  LINE_WIDTH_PX,
  RIBBON_WIDTH_M,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM,
  TILE_SIZE,
  TILE_URL,
} from "../shared/config";
import { fetchLineTile, type LineTile } from "../shared/tile";
import type { ColorMode, Shape } from "../shared/ui";
import { type DeckTile, deckTile, featureIdAt, OFFSET_ZOOM } from "./tile";

interface FlightsLayerProps {
  colorMode: ColorMode;
  shape: Shape;
}

/**
 * Tiles of 3D lines, one stock `PathLayer` per tile drawing the decoded `Int32Array` as its
 * positions. Like deck.gl's `MVTLayer`, it keeps the hovered feature in its state rather than
 * its props, and sets what changes without the tile's data, the highlight and the placement, per
 * tile in `getSubLayerPropsByTile`: a new highlight clones only the tiles whose highlight changes.
 */
export class FlightsLayer extends TileLayer<DeckTile | null, FlightsLayerProps> {
  static layerName = "FlightsLayer";

  declare state: TileLayer<DeckTile | null>["state"] & {
    /** The hovered feature's id, which its piece in every tile shares; `null` for none. */
    hoveredFeatureId: number | null;
    /** Stops listening for the pointer leaving the canvas. */
    leave: AbortController;
  };

  initializeState(): void {
    super.initializeState();
    // deck.gl does not report the pointer leaving the canvas to `_updateAutoHighlight`: its
    // picker finds no viewport at the leave position and returns before telling the layers. The
    // state is shared by every instance of this layer deck.gl matches, so this one can clear it.
    const leave = new AbortController();
    this.context.device
      .getDefaultCanvasContext()
      .canvas.addEventListener("pointerleave", () => this.setState({ hoveredFeatureId: null }), {
        signal: leave.signal,
      });
    this.setState({ hoveredFeatureId: null, leave });
  }

  finalizeState(): void {
    this.state.leave.abort();
    super.finalizeState();
  }

  /** Called by deck.gl's picker when the hovered object changes, to none included, within the canvas. */
  protected _updateAutoHighlight(info: TileLayerPickingInfo<DeckTile | null>): void {
    const content = info.picked ? info.tile?.content : null;
    const hovered = content ? featureIdAt(content, info.index) : null;
    if (hovered !== this.state.hoveredFeatureId) this.setState({ hoveredFeatureId: hovered });
  }

  renderSubLayers(sub: { id: string; data: DeckTile | null }): Layer | null {
    return sub.data && renderTile(sub.id, sub.data, this.props);
  }

  getSubLayerPropsByTile(tile: Tile2DHeader<DeckTile | null>): Partial<LayerProps> | null {
    const content = tile.content;
    if (!content) return null;
    const { hoveredFeatureId } = this.state;
    const feature =
      hoveredFeatureId === null
        ? undefined
        : content.tile.featureIds.featureOfId.get(hoveredFeatureId);
    const { low, high } = content.placement.modelMatrix;
    return {
      highlightedObjectIndex: feature ?? -1,
      modelMatrix: this.context.viewport.zoom < OFFSET_ZOOM ? low : high,
    };
  }

  /** The decoded tiles drawn now, ancestors standing in for loading tiles included. */
  drawnTiles(): LineTile[] {
    const { tileset } = this.state;
    if (!tileset) throw new Error("FlightsLayer has no tileset before it is initialised");
    const tiles: Tile2DHeader<DeckTile | null>[] = tileset.tiles;
    return tiles.flatMap((t) => (t.isVisible && t.content ? [t.content.tile] : []));
  }
}

/** The layer with this PoC's tiles. */
export function flightsLayer(
  props: FlightsLayerProps & Pick<TileLayerProps<DeckTile | null>, "onViewportLoad">,
): FlightsLayer {
  return new FlightsLayer({
    id: "flights",
    data: TILE_URL,
    minZoom: TILE_MIN_ZOOM,
    maxZoom: TILE_MAX_ZOOM,
    tileSize: TILE_SIZE,
    // Tile culling must account for lines up in the air.
    zRange: [...ALTITUDE_RANGE_M],
    // `TileLayer` fills in `url` from `data` for the prop, not for an overridden method.
    getTileData: ({ url, index, signal }) => {
      if (!url) throw new Error(`no URL for tile ${index.z}/${index.x}/${index.y}`);
      return fetchLineTile(url, index, signal).then((tile) => tile && deckTile(tile));
    },
    pickable: true,
    // deck.gl then reports hovers to `_updateAutoHighlight`.
    autoHighlight: true,
    ...props,
  });
}

function renderTile(id: string, tile: DeckTile, props: FlightsLayerProps): Layer {
  const ribbons = props.shape === "ribbons";
  return new PathLayer({
    id: `${id}-paths`,
    // The tile's cached object: the same one on every render, unless the colour mode changes.
    data: tile.data[props.colorMode],
    // The lines are ready to draw: no closing, no copy into deck.gl's own buffer.
    _pathType: "open",
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    coordinateOrigin: tile.placement.coordinateOrigin,
    // Screen-space lines, or flat ribbons extruded on the ground plane with rounded joins.
    billboard: !ribbons,
    widthUnits: ribbons ? "meters" : "pixels",
    getWidth: ribbons ? RIBBON_WIDTH_M : LINE_WIDTH_PX,
    jointRounded: ribbons,
    pickable: true,
    highlightColor: [255, 255, 255, 255],
  });
}
