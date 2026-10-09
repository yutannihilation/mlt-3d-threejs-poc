import type { LayerProps } from "@deck.gl/core";
import { toElevation } from "@maplibre/mlt-wasm";
import { ALTITUDE_RANGE_M } from "../shared/config";
import { lineStyleTexels, vertexColors } from "../shared/style";
import type { LineTile } from "../shared/tile";
import { metreScale, type TileFrame } from "../shared/transform";
import type { ColorMode } from "../shared/ui";

/** A column-major 4 x 4 matrix, as deck.gl takes it. */
type Matrix = NonNullable<LayerProps["modelMatrix"]>;

/** deck.gl's common space is 512 units across the world, with y pointing north. */
const WORLD_SIZE = 512;

/**
 * deck.gl switches its Web Mercator viewports to offset mode from this zoom (`Viewport.projectionMode`,
 * not exported), which changes how it scales altitude in `CARTESIAN` coordinates.
 */
export const OFFSET_ZOOM = 12;

/**
 * A tile placed in deck.gl's `CARTESIAN` coordinates, the way its `MVTLayer` places tiles: the
 * decoded integers are the positions, a per-tile `modelMatrix` scales them, and
 * `coordinateOrigin` puts the tile's north-west corner in common space.
 *
 * deck.gl takes the scaled `z` as metres and multiplies it by common units per metre: at the
 * equator below `OFFSET_ZOOM`, and at the viewport centre's latitude, corrected linearly per
 * vertex, from it. A metre spans `cosh(π (1 − 2y))` times more at Mercator `y` than at the
 * equator, so the matrix for low zooms adds that factor at the tile's centre.
 */
export interface DeckPlacement {
  readonly coordinateOrigin: [number, number, number];
  /** Below `OFFSET_ZOOM` and from it. */
  readonly modelMatrix: { readonly low: Matrix; readonly high: Matrix };
}

export function deckPlacement(frame: TileFrame, extent: number): DeckPlacement {
  const [x0, y0] = frame.origin;
  const s = WORLD_SIZE * frame.scale;
  const centreY = y0 + (frame.scale * extent) / 2;
  const latitudeFactor = metreScale(centreY);
  // Tile coordinates to common units, y flipped; the z grid to metres.
  // prettier-ignore
  const matrix = (zFactor: number): Matrix => [
    s, 0, 0, 0,
    0, -s, 0, 0,
    0, 0, frame.zScale * zFactor, 0,
    0, 0, frame.zOffset * zFactor, 1,
  ];
  return {
    coordinateOrigin: [WORLD_SIZE * x0, WORLD_SIZE * (1 - y0), 0],
    modelMatrix: { low: matrix(latitudeFactor), high: matrix(1) },
  };
}

/**
 * A tile's lines as `PathLayer` binary data: per line where it starts, and per vertex the decoded
 * position, a colour, and the feature.
 *
 * deck.gl compares `data` by reference and rebuilds every attribute when it changes, so each
 * tile builds this once per colour mode and hands the same object to every `PathLayer` it
 * renders: a new highlight then changes only uniforms.
 */
export interface PathData {
  readonly length: number;
  readonly startIndices: Uint32Array;
  readonly attributes: {
    /** The decoded vertices as they are: integer data feeds the float attribute. */
    readonly getPath: { readonly value: Int32Array; readonly size: 3 };
    /** `r, g, b` per vertex. */
    readonly getColor: { readonly value: Uint8Array; readonly size: 3; readonly normalized: true };
    /**
     * The feature of each vertex. deck.gl picks and highlights by this row index, so every line
     * of a feature is picked as the feature and highlighted with it.
     */
    readonly rowIndexes: { readonly value: Uint32Array; readonly size: 1 };
  };
}

/** A decoded tile with what deck.gl's `PathLayer` needs next to the decoded vertices. */
export interface DeckTile {
  readonly tile: LineTile;
  readonly placement: DeckPlacement;
  readonly data: Record<ColorMode, PathData>;
}

/** The id of the feature in row `row`: the row index is the feature, see `PathData`. */
export function featureIdAt(tile: DeckTile, row: number): number {
  return tile.tile.featureIds.idOfFeature[row];
}

export function deckTile(tile: LineTile): DeckTile {
  const { layer, ids, frame, zStep } = tile;
  const { vertices } = layer.geometry;
  const count = ids.lineOfVertex.length;
  const metres = new Float32Array(count);
  const rowIndexes = new Uint32Array(count);
  for (let v = 0; v < count; v++) {
    metres[v] = toElevation(vertices[v * 3 + 2], zStep);
    rowIndexes[v] = ids.featureOfLine[ids.lineOfVertex[v]];
  }
  const { texels } = lineStyleTexels(layer, ids.featureOfLine);
  const colors = vertexColors(metres, ids.lineOfVertex, texels, ALTITUDE_RANGE_M);
  const data = (color: Uint8Array): PathData => ({
    length: ids.featureOfLine.length,
    startIndices: ids.lineStart,
    attributes: {
      getPath: { value: vertices, size: 3 },
      getColor: { value: color, size: 3, normalized: true },
      rowIndexes: { value: rowIndexes, size: 1 },
    },
  });
  return {
    tile,
    placement: deckPlacement(frame, layer.extent),
    data: { altitude: data(colors.altitude), direction: data(colors.direction) },
  };
}
